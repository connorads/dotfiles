def insert (x : Nat) : List Nat → List Nat
  | [] => [x]
  | y :: ys => if x ≤ y then x :: y :: ys else y :: insert x ys

def isort : List Nat → List Nat
  | [] => []
  | x :: xs => insert x (isort xs)
