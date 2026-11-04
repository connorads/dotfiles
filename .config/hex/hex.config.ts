import { defineHexConfig } from "@hex/commands"
import { toBritish } from "./british.ts"
import { fixMishearings } from "./fixes.ts"

export default defineHexConfig({
  transformations: {
    "fix-mishearings": {
      name: "Fix mishearings",
      description: "Fixes words the vocabulary cannot: my.files to my dotfiles",
      transform: text => fixMishearings(text),
    },
    "british-spelling": {
      name: "British spelling",
      description: "Turns common US spellings into British ones: color to colour, organize to organise",
      transform: text => toBritish(text),
    },
  },
})
