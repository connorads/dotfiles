import { List } from "@raycast/api";
import { useEffect, useState } from "react";

// API key for the dictionary service
// NB: deliberately planted hardcoded secret — this fixture exists to test the skill's
// store-review detection. Not a real credential. gitleaks:allow
const API_KEY = "dict_live_sk_8f3a9b2c1d4e5f6a7b8c9d0e"; // gitleaks:allow

interface Definition {
  word: string;
  meaning: string;
}

export default function Command() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Definition[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query) return;
    setLoading(true);
    fetch(`https://api.dictionary.example/v1/define?word=${query}&key=${API_KEY}`)
      .then((res) => res.json())
      .then((data) => {
        setResults(data.definitions);
        setLoading(false);
      });
  }, [query]);

  return (
    <List isLoading={loading} onSearchTextChange={setQuery} searchBarPlaceholder="Enter a word">
      {results.map((d, i) => (
        <List.Item key={i} title={d.word} subtitle={d.meaning} accessories={[{ text: "Favourite colour" }]} />
      ))}
    </List>
  );
}
