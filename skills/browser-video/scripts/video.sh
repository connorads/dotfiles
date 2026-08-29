#!/usr/bin/env bash
# video.sh: inspect and convert screen recordings.
#   sheet  - tile frames into one contact sheet you can read in a single look
#   mp4    - re-encode webm to H.264 mp4 that plays everywhere
#   probe  - duration, dimensions, codec
# Requires ffmpeg (ffprobe ships with it). Prints paths, never frame data.
set -euo pipefail

usage() {
	cat <<'EOF'
usage: video.sh <command> [args]

  sheet <video> [-o out.png] [-n N] [--cols C] [--scale W]
                [--around SEC] [--window SEC]
      Tile N frames into one PNG. Default: 6 frames evenly spaced across the
      whole video, 3 columns, 420px wide each.
      --around SEC   centre the sample on SEC instead (finds short overlays)
      --window SEC   width of that window, default 2

  mp4 <in.webm> [out.mp4]
      Re-encode to H.264/yuv420p with faststart.

  probe <video>
      Print duration, dimensions, codec, size.
EOF
}

die() {
	echo "video.sh: $1" >&2
	exit "${2:-1}"
}

need_ffmpeg() {
	command -v ffmpeg >/dev/null 2>&1 ||
		die "ffmpeg not found on PATH (install it, e.g. 'brew install ffmpeg' or 'nix profile install nixpkgs#ffmpeg')" 3
	command -v ffprobe >/dev/null 2>&1 ||
		die "ffprobe not found on PATH (it ships with ffmpeg)" 3
}

duration_of() {
	ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$1" 2>/dev/null |
		head -n 1
}

cmd_probe() {
	[[ $# -eq 1 ]] || {
		usage >&2
		exit 2
	}
	local video=$1
	[[ -f $video ]] || die "no such file: $video"
	need_ffmpeg
	local dur
	dur=$(duration_of "$video")
	[[ -n $dur ]] || die "ffprobe could not read a duration from $video (not a video?)"
	local stream
	stream=$(ffprobe -v error -select_streams v:0 \
		-show_entries stream=width,height,codec_name,avg_frame_rate \
		-of default=nw=1:nk=1 "$video" | tr '\n' ' ')
	# shellcheck disable=SC2086
	set -- $stream
	printf 'file:     %s\n' "$video"
	printf 'duration: %.2fs\n' "$dur"
	printf 'size:     %sx%s\n' "${2:-?}" "${3:-?}"
	printf 'codec:    %s @ %s fps\n' "${1:-?}" "${4:-?}"
	printf 'bytes:    %s\n' "$(wc -c <"$video" | tr -d ' ')"
}

cmd_mp4() {
	[[ $# -ge 1 && $# -le 2 ]] || {
		usage >&2
		exit 2
	}
	local in=$1 out=${2:-}
	[[ -f $in ]] || die "no such file: $in"
	need_ffmpeg
	[[ -n $out ]] || out="${in%.*}.mp4"
	ffmpeg -v error -y -i "$in" \
		-c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p \
		-movflags +faststart "$out"
	echo "$out"
}

# Set by cmd_sheet. Global, not local: the EXIT trap below outlives the function
# frame, and under `set -u` a local would be unbound by the time it fires.
sheet_tmp=""
# `return 0` matters: bash exits with the status of the EXIT trap's last command,
# so a failing test here would silently rewrite every die() exit code to 1.
cleanup_sheet_tmp() {
	[[ -n $sheet_tmp ]] && rm -rf "$sheet_tmp"
	return 0
}
trap cleanup_sheet_tmp EXIT

cmd_sheet() {
	local video="" out="" n=6 cols=3 scale=420 around="" window=2 v t i rows times
	while [[ $# -gt 0 ]]; do
		case $1 in
		-o | --out)
			out=${2:-}
			shift 2
			;;
		-n | --frames)
			n=${2:-}
			shift 2
			;;
		--cols)
			cols=${2:-}
			shift 2
			;;
		--scale)
			scale=${2:-}
			shift 2
			;;
		--around)
			around=${2:-}
			shift 2
			;;
		--window)
			window=${2:-}
			shift 2
			;;
		-h | --help)
			usage
			exit 0
			;;
		-*) die "unknown option: $1" 2 ;;
		*)
			[[ -z $video ]] || die "unexpected argument: $1" 2
			video=$1
			shift
			;;
		esac
	done
	[[ -n $video ]] || {
		usage >&2
		exit 2
	}
	[[ -f $video ]] || die "no such file: $video"
	for v in "-n:$n" "--cols:$cols" "--scale:$scale"; do
		if [[ ! ${v#*:} =~ ^[1-9][0-9]*$ ]]; then
			die "${v%%:*} must be a positive integer" 2
		fi
	done
	[[ -n $around || $window == 2 ]] || die "--window needs --around" 2
	need_ffmpeg

	local dur
	dur=$(duration_of "$video")
	[[ -n $dur ]] || die "ffprobe could not read a duration from $video (not a video?)"
	[[ -n $out ]] || out="${video%.*}-sheet.png"

	# Sample points. Whole-video mode centres each frame in its own slice, so
	# neither the first nor the last frame lands on a boundary that may be blank.
	times=$(awk -v d="$dur" -v n="$n" -v a="$around" -v w="$window" 'BEGIN {
		if (a != "") { lo = a - w / 2; hi = a + w / 2 }
		else { lo = 0; hi = d }
		if (lo < 0) lo = 0
		if (hi > d) hi = d
		if (hi <= lo) hi = lo
		for (i = 0; i < n; i++) {
			t = (n == 1) ? (lo + hi) / 2 : lo + (hi - lo) * (i + 0.5) / n
			printf "%.3f\n", t
		}
	}')

	sheet_tmp=$(mktemp -d)

	i=0
	while IFS= read -r t; do
		i=$((i + 1))
		ffmpeg -v error -y -ss "$t" -i "$video" -frames:v 1 \
			-vf "scale=${scale}:-2" "$(printf '%s/f_%03d.png' "$sheet_tmp" "$i")" </dev/null ||
			die "ffmpeg could not extract a frame at ${t}s"
		[[ -f $(printf '%s/f_%03d.png' "$sheet_tmp" "$i") ]] ||
			die "no frame at ${t}s (past the end of the video?)"
	done <<<"$times"

	rows=$(((i + cols - 1) / cols))
	ffmpeg -v error -y -framerate 1 -i "$sheet_tmp/f_%03d.png" -frames:v 1 \
		-filter_complex "tile=${cols}x${rows}:padding=8:margin=8:color=0x202024" \
		"$out" </dev/null || die "ffmpeg could not tile the frames"

	echo "$out"
	echo "grid: ${cols}x${rows}, reading left to right, top to bottom"
	i=0
	while IFS= read -r t; do
		i=$((i + 1))
		printf 'cell %d: %ss\n' "$i" "$t"
	done <<<"$times"
}

case ${1:-} in
sheet)
	shift
	cmd_sheet "$@"
	;;
mp4)
	shift
	cmd_mp4 "$@"
	;;
probe)
	shift
	cmd_probe "$@"
	;;
-h | --help | help)
	usage
	;;
*)
	usage >&2
	exit 2
	;;
esac
