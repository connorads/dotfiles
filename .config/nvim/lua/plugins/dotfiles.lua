-- Show hidden files in the smart picker when cwd is ~ (dotfiles worktree)
return {
  {
    "folke/snacks.nvim",
    keys = {
      {
        "<leader><leader>",
        function()
          Snacks.picker.smart({
            hidden = vim.fn.getcwd() == vim.fn.expand("~"),
          })
        end,
        desc = "Find Files",
      },
    },
  },
}
