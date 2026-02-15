-- MDX support via mdx.nvim: filetype detection, treesitter injection, tsx highlighting
-- LazyVim's markdown extra sets mdx filetype to "markdown.mdx"; mdx.nvim sets it to "mdx".
-- Loading order determines which wins, so we configure both filetypes defensively.
return {
  { "connorads/mdx.nvim", config = true, dependencies = { "nvim-treesitter/nvim-treesitter" } },
  { "nvim-treesitter/nvim-treesitter", opts = { ensure_installed = { "tsx", "typescript" } } },
  -- Disable markdownlint for MDX (rules aren't designed for JSX/imports)
  {
    "mfussenegger/nvim-lint",
    opts = { linters_by_ft = { mdx = {}, ["markdown.mdx"] = {} } },
  },
  -- Prettier-only formatting for MDX (override LazyVim's markdownlint-cli2 + markdown-toc)
  {
    "stevearc/conform.nvim",
    opts = { formatters_by_ft = { mdx = { "prettier" }, ["markdown.mdx"] = { "prettier" } } },
  },
}
