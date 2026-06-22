-- Nix language support: ensure the Treesitter parser is installed so .nix files
-- (the most-edited language in this repo) get highlighting. nvim-treesitter's
-- main branch dropped FileType-triggered auto-install, so the parser must be
-- declared explicitly — same pattern as mdx.lua. For full IDE support (nil_ls
-- LSP + nixfmt) enable the LazyVim `lang.nix` extra via :LazyExtras.
return {
  { "nvim-treesitter/nvim-treesitter", opts = { ensure_installed = { "nix" } } },
}
