-- Minimal LazyVim bootstrap
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not (vim.uv or vim.loop).fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable",
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)

vim.g.mapleader = " "
vim.g.maplocalleader = " "

-- Word wrap on by default
vim.opt.wrap = true

-- Auto-reload files changed externally (e.g. AI edits)
vim.o.autoread = true
vim.api.nvim_create_autocmd({ "FocusGained", "BufEnter", "CursorHold" }, {
  command = "checktime",
})

-- Auto-reload init.lua on save (re-applies options/autocmds; plugin changes need restart)
vim.api.nvim_create_autocmd("BufWritePost", {
  pattern = vim.fn.stdpath("config") .. "/init.lua",
  command = "source <afile>",
  desc = "Reload init.lua on save",
})

-- Guard so lazy.setup only runs once (not on every :source)
if not vim.g.lazy_did_setup then
  vim.g.lazy_did_setup = true
  require("lazy").setup({
    {
      "LazyVim/LazyVim",
      import = "lazyvim.plugins",
    },
    { import = "plugins" },
  })
end
