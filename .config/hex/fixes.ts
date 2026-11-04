// Mishearings the vocabulary cannot fix. Parakeet hears "my dotfiles" as
// "my.files", and vocabulary rescoring leaves path-like tokens alone.
export const fixMishearings = (text: string) => text.replace(/\b([A-Za-z]+)\.files\b/g, "$1 dotfiles")
