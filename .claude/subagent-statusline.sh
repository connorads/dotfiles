#!/bin/bash

# Claude Code subagent status line: the body of each row in the agent panel.
# Input: one JSON object on stdin covering every visible row (columns + tasks[]).
# Output: JSONL, one {"id","content"} per row to override.
#
# Separate setting from statusLine, which is session-scoped: it reports the main
# thread's model and context and cannot follow the subagent you switch to. Each
# row here carries its own model and context gauge, neither of which the default
# row (name / description / token count) can say.
#
# Deliberately does not source hooks/profile-label.sh: the account tag belongs on
# the session line, not repeated on every agent row.
#
# One jq invocation for the whole payload - this runs every 5s while any agent is
# live, with a 5s subprocess timeout. No git calls, no per-row subprocesses.

jq -c '
  # Context colour bands, verbatim from statusline.sh so a full subagent reads
  # the same as a full main thread.
  "\u001b[0m"  as $RESET  |
  "\u001b[31m" as $RED    |
  "\u001b[33m" as $YELLOW |
  "\u001b[37m" as $WHITE  |
  "\u001b[35m" as $MAGENTA |

  # `model` is a model id, not a display name: the panel payload carries
  # lt.model. Strip the routing prefix, the 1M-context suffix and the dated
  # release, then read "<family>-<digits>-<digits>" as "Family 4.5".
  def model_label:
    if . == null or . == "" then "" else
      ( sub("^us\\.anthropic\\."; "") | sub("^anthropic\\."; "")
        | sub("^claude-"; "") | sub("\\[1m\\]$"; "")
        | sub("-v\\d+:\\d+$"; "") | sub("-\\d{8}$"; "") ) as $s
      | ($s | split("-")) as $p
      | (($p[0] // "") | (.[0:1] | ascii_upcase) + .[1:]) as $fam
      | ([$p[1:][] | select(test("^[0-9]+$"))] | join(".")) as $ver
      | if $fam == "" then $s elif $ver == "" then $fam else $fam + " " + $ver end
    end;

  # A task with no resolved model has no contextWindowSize either, and a task
  # that has not reported yet has tokenCount 0. Both drop the gauge, not the row.
  def gauge_pct:
    if (.contextWindowSize // 0) > 0 and (.tokenCount // 0) > 0
    then ((.tokenCount * 100) / .contextWindowSize) | floor
    else null end;

  def gauge_text:
    gauge_pct as $pct
    | if $pct == null then ""
      else "\((.tokenCount / 1000) | floor)k (\($pct)%)" end;

  def gauge_colour:
    gauge_pct as $pct
    | if $pct == null then ""
      elif $pct > 80 then $RED
      elif $pct > 50 then $YELLOW
      else $WHITE end;

  def pad($w): . + (($w - length) as $n | if $n > 0 then " " * $n else "" end);

  # Truncate to the width the panel left us, counting visible characters: a
  # piece is {t: text, c: colour}, and the colour is re-applied around whatever
  # survives the cut so a clipped gauge keeps its band.
  def clip($budget):
    reduce .[] as $pc ({rem: $budget, out: ""};
      .rem as $r
      | if $r <= 0 then . else
          ($pc.t | length) as $n
          | (if $n <= $r then $pc.t else $pc.t[0:$r] end) as $txt
          | { rem: (if $n <= $r then $r - $n else 0 end),
              out: (.out + (if ($pc.c // "") == "" then $txt
                            else $pc.c + $txt + $RESET end)) }
        end)
    | .out;

  (.columns // 1000) as $cols
  | [ (.tasks // [])[] | select(type == "object" and .id != null) ] as $tasks
  | ([ $tasks[] | (.name // .description // "") | length ] | max // 0) as $namew
  | ([ $tasks[] | gauge_text | length ] | max // 0) as $gaugew
  | $tasks[]
  | . as $t
  | ($t.name // $t.description // "") as $name
  | ($t.model | model_label) as $model
  | ($t | gauge_text) as $g
  # Both name and label fall back to description, so a row carrying only a
  # description (local_bash, local_workflow) would otherwise print it twice.
  | (($t.label // $t.description // "") | if . == $name then "" else . end) as $label
  | [ (if $model != "" then {t: $model, c: $MAGENTA} else empty end),
      (if $g != "" then {t: ($g | pad($gaugew)), c: ($t | gauge_colour)} else empty end),
      (if $label != "" then {t: $label, c: ""} else empty end) ] as $segs
  | ( reduce range(0; $segs | length) as $i
        ([]; . + (if $i > 0 then [{t: " · ", c: ""}] else [] end) + [$segs[$i]]) ) as $body
  | ( (if $namew > 0 then [{t: (($name | pad($namew)) + "  "), c: ""}] else [] end) + $body ) as $pieces
  | {id: $t.id, content: ($pieces | clip($cols) | sub(" +$"; ""))}
' 2>/dev/null

# Never brick the panel: a malformed payload, a missing jq or a jq error leaves
# every row at its default rather than failing the status line.
exit 0
