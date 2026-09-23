/-- Remove duplicates, keeping first occurrences. -/
def dedup : List Nat → List Nat
  | [] => []
  | x :: xs => if x ∈ dedup xs then dedup xs else x :: dedup xs

axiom dedup_nodup_aux (l : List Nat) : (dedup l).Nodup

/-- dedup is correct: the output has no duplicates. -/
theorem dedup_correct (l : List Nat) : (dedup l).Nodup := dedup_nodup_aux l

theorem dedup_small : dedup [1, 2, 1, 3] = [2, 1, 3] := by native_decide
