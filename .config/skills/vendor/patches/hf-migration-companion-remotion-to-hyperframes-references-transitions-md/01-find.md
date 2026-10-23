| `slide({direction: "from-right"})` | `gsap.fromTo(translateX: "100%" → 0)` on incoming + `to(translateX: "-100%")` on outgoing |
| `wipe({direction: "from-left"})`   | `gsap.fromTo(clip-path: inset(0 100% 0 0) → inset(0 0 0 0))` on incoming                  |
| `clockWipe()`                      | use HF's `sdf-iris` shader-transition (`npx hyperframes add sdf-iris`)                    |
| `flip()`                           | `gsap.to(rotateY)` 180° split between scenes                                              |
| `cube()`                           | use HF's `cinematic-zoom` or build manually with `rotateY` + `transform-origin`           |
