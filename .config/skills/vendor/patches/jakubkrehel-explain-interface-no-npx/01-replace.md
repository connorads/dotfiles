{{marker}}
Use browser tooling that is already available in the session first. If the user explicitly asks to install Chrome DevTools MCP, use the repo's approved package-manager path rather than `npx`.

Chrome DevTools MCP gives you `evaluate_script` for the recipes here, `resize_page` and `take_screenshot` for another width, `list_network_requests` for what is served and `performance_start_trace` for a stutter. Prefer it over the fetch method when:
