// US to UK spellings for dictated prose. Explicit word lists, not suffix rules,
// so words like "size", "prize" and "meter" stay as they are.

const IZE_STEMS = [
  "apolog", "author", "capital", "categor", "central", "character", "critic", "custom",
  "emphas", "final", "general", "initial", "legal", "maxim", "memor", "minim", "modern",
  "normal", "optim", "organ", "penal", "prioritiz", "real", "recogn", "serial", "special",
  "standard", "summar", "symbol", "synchron", "util", "visual",
]
const IZE_ENDINGS: [string, string][] = [
  ["ize", "ise"], ["izes", "ises"], ["ized", "ised"], ["izing", "ising"],
  ["ization", "isation"], ["izations", "isations"], ["izer", "iser"], ["izers", "isers"],
]
const OR_STEMS = ["behavi", "col", "fav", "flav", "hon", "hum", "lab", "neighb", "rum", "harb", "vap", "endeav"]
const OR_ENDINGS: [string, string][] = [
  ["or", "our"], ["ors", "ours"], ["ored", "oured"], ["oring", "ouring"],
  ["orful", "ourful"], ["orite", "ourite"], ["orites", "ourites"], ["orable", "ourable"],
]
const WORDS: Record<string, string> = {
  analyze: "analyse", analyzes: "analyses", analyzed: "analysed", analyzing: "analysing",
  paralyze: "paralyse", paralyzed: "paralysed",
  center: "centre", centers: "centres", centered: "centred", theater: "theatre", theaters: "theatres",
  fiber: "fibre", liter: "litre", liters: "litres",
  defense: "defence", offense: "offence",
  gray: "grey", catalog: "catalogue", catalogs: "catalogues",
  canceled: "cancelled", canceling: "cancelling", traveled: "travelled", traveling: "travelling",
  traveler: "traveller", travelers: "travellers", modeling: "modelling", modeled: "modelled",
  labeled: "labelled", labeling: "labelling", signaled: "signalled", signaling: "signalling",
  fulfill: "fulfil", fulfillment: "fulfilment", enrollment: "enrolment",
  aluminum: "aluminium", mom: "mum", moms: "mums",
}

const table = new Map<string, string>(Object.entries(WORDS))
for (const stem of IZE_STEMS) {
  const base = stem.endsWith("iz") ? stem.slice(0, -2) : stem
  for (const [us, uk] of IZE_ENDINGS) table.set(base + us, base + uk)
}
for (const stem of OR_STEMS) for (const [us, uk] of OR_ENDINGS) table.set(stem + us, stem + uk)

const matchCase = (original: string, replacement: string) =>
  original === original.toUpperCase() && original.length > 1 ? replacement.toUpperCase()
  : original[0] === original[0]!.toUpperCase() ? replacement[0]!.toUpperCase() + replacement.slice(1)
  : replacement

export const toBritish = (text: string) =>
  text.replace(/[A-Za-z]+/g, word => {
    const uk = table.get(word.toLowerCase())
    return uk === undefined ? word : matchCase(word, uk)
  })
