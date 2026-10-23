| `parakeet-mlx`     | local transcription (default ASR, best) on Apple Silicon                    | `uv venv ~/.venvs/parakeet && VIRTUAL_ENV=~/.venvs/parakeet uv pip install parakeet-mlx`                                                                                                    |
| `ltx-2-mlx`        | local video gen                                                             | `git clone https://github.com/dgrauet/ltx-2-mlx && cd ltx-2-mlx && uv sync --all-extras`                                                                                                    |
| `npx hyperframes`  | Kokoro TTS (voice), Parakeet or whisper.cpp (transcribe), remove-background | via the hyperframes CLI; Parakeet on macOS, Windows and glibc 2.32+ Linux: `npx hyperframes models install parakeet`; whisper.cpp is built on first use (Homebrew on macOS, else git+cmake) |

The RAM-graded local-model shortlist + exact per-tier install/invoke lives in
