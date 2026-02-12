local function open_local_doc(path)
  vim.cmd.edit(vim.fn.expand(path))
end

return {
  {
    "LazyVim/LazyVim",
    keys = {
      {
        "<leader>hh",
        function()
          open_local_doc("~/.config/nvim/help.md")
        end,
        desc = "Neovim Help",
      },
      {
        "<leader>hp",
        function()
          open_local_doc("~/.config/nvim/practice.md")
        end,
        desc = "Neovim Practice",
      },
    },
    init = function()
      vim.api.nvim_create_user_command("NvimHelp", function()
        open_local_doc("~/.config/nvim/help.md")
      end, { desc = "Open local Neovim help" })

      vim.api.nvim_create_user_command("NvimPractice", function()
        open_local_doc("~/.config/nvim/practice.md")
      end, { desc = "Open local Neovim practice drills" })
    end,
  },
}
