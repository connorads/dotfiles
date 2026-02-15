-- MDX support via mdx.nvim: filetype detection, treesitter injection, tsx highlighting
return {
  { "connorads/mdx.nvim", config = true, dependencies = { "nvim-treesitter/nvim-treesitter" } },
  { "nvim-treesitter/nvim-treesitter", opts = { ensure_installed = { "tsx", "typescript" } } },
  -- Disable markdownlint for MDX (rules aren't designed for JSX/imports)
  { "mfussenegger/nvim-lint", opts = { linters_by_ft = { mdx = {} } } },
  -- Prettier formatting for MDX
  { "stevearc/conform.nvim", opts = { formatters_by_ft = { mdx = { "prettier" } } } },
}
