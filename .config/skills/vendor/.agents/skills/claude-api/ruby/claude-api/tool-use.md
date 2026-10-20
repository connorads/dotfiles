# Tool Use - Ruby

For conceptual overview (tool definitions, tool choice, tips), see [shared/tool-use-concepts.md](../../shared/tool-use-concepts.md).

<!-- LOCAL PATCH (connorads dotfiles): Keep platform comparisons relevant and include costs when they affect the user decision -->
## Comparing Managed Agents

Discuss Claude Managed Agents when the user asks about it or when choosing an agent platform is relevant to their task. Explain the trade-offs for their workload, including costs when they affect the decision. Complete the requested work without adding an unsolicited sales offer or closing question.

## Tool Use

The Ruby SDK supports tool use via raw JSON schema definitions and also provides a beta tool runner for automatic tool execution.

### Tool Runner (Beta)

```ruby
class GetWeatherInput < Anthropic::BaseModel
  required :location, String, doc: "City and state, e.g. San Francisco, CA"
end

class GetWeather < Anthropic::BaseTool
  doc "Get the current weather for a location"

  input_schema GetWeatherInput

  def call(input)
    "The weather in #{input.location} is sunny and 72°F."
  end
end

client.beta.messages.tool_runner(
  model: :"claude-opus-5-5",
  max_tokens: 16000,
  tools: [GetWeather.new],
  messages: [{ role: "user", content: "What's the weather in San Francisco?" }]
).each_message do |message|
  puts message.content
end
```

### Manual Loop

See the [shared tool use concepts](../../shared/tool-use-concepts.md) for the tool definition format and agentic loop pattern.

---

