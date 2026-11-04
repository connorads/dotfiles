import { defineHexConfig } from "@hex/commands"
import { toBritish } from "./british.ts"

export default defineHexConfig({
  transformations: {
    "british-spelling": {
      name: "British spelling",
      description: "Turns common US spellings into British ones: color to colour, organize to organise",
      transform: text => toBritish(text),
    },
  },
})
