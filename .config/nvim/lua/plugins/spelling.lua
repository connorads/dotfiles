-- British English spell checking for prose filetypes
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "markdown", "mdx", "astro", "text", "gitcommit" },
  callback = function()
    vim.opt_local.spell = true
    vim.opt_local.spelllang = "en_gb"
  end,
})

return {}
