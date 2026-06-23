# Dice-Based Chess Game Dynamics

## 1. Game Overview

This game is a chess variant where each turn begins with a dice roll.  
The dice determines which **piece type** the active player may use on that turn.

The game starts with **White's turn**.

The core rule is:

- If the dice-selected piece type has at least one legal move on the board, the player must be allowed to move that piece type or skip the turn.
- If the dice-selected piece type has no legal move anywhere on the board, the turn must pass to the opponent.
- When a player is in check, only dice results that can legally resolve the check are valid for that player’s turn.

Except for the dice-based turn restriction, the game follows **standard chess rules**.

---

## 2. Standard Chess Rules That Still Apply

The following traditional chess dynamics remain active in this game:

- normal piece movement rules
- captures
- en passant
- pawn promotion
- castling, if the move is legal under standard chess rules
- check
- checkmate
- stalemate
- draw conditions, if supported by the implementation

The dice does **not** change how pieces move in chess.  
It only controls **which piece type is eligible to be moved on that turn**.

---

## 3. Turn Order

1. The game starts with **White**.
2. The active player rolls the dice.
3. The dice returns a piece type, such as:
   - pawn
   - knight
   - bishop
   - rook
   - queen
   - king
4. The game checks whether that piece type has at least one legal move available.
5. Based on that result, either:
   - the player may move a valid piece of that type, or
   - the turn is skipped automatically if no legal move exists.

---

## 4. Dice-Based Move Eligibility

When the dice selects a piece type, the game must internally verify the legal move availability for that piece type.

### 4.1 If legal moves exist
If at least one piece of the selected type has at least one legal move:

- the player must be allowed to make a move using that piece type
- the player may choose **any valid piece** of that type that can legally move
- the player may also choose to **skip** the turn if skipping is allowed by the design
- the turn must **not** be transferred to the opponent before the player has had the opportunity to act

### 4.2 If no legal moves exist
If no piece of the selected type can legally move:

- the turn must not remain with the active player
- the turn changes to the opponent automatically

### 4.3 Multiple pieces of the same type
If there are multiple pieces of the dice-selected type, the game must check all of them.

Example:
- If White has two knights, and only one knight can move, then the dice result **Knight** is valid.
- The player should be allowed to move the movable knight.
- The game must not reject the turn just because one knight is blocked.

---

## 5. Player Choice on a Valid Dice Result

If the dice result corresponds to a piece type that has at least one legal move, the player has a choice:

- make a legal move with that piece type
- skip the turn

The game must not force an immediate turn change before the player chooses.

The UI should clearly show that the rolled piece type is available for action when legal moves exist.

---

## 6. Turn Skipping

A player may skip the turn only when the game allows it as part of the turn flow.

### Skip behavior
- If the player skips, no piece is moved.
- The board state remains unchanged.
- The turn passes to the opponent.

### Important
If legal moves exist for the rolled piece type, the game must not silently force a skip or auto-switch to the opponent before the player decides.

---

## 7. Board Update and UI Synchronization

After a legal move:

- the moved piece must appear on the destination square
- both players’ UIs must show the same updated board state
- the old square must be cleared correctly
- captured pieces must be removed consistently on both sides

The UI must never show a mismatch between the actual game state and the visible board state.

### UI rule for move completion
A move is complete only when:
- the internal game state is updated
- the board is updated in both UIs
- the turn is advanced correctly

---

## 8. Check Rules

If a king is in check, the turn handling becomes stricter.

### 8.1 When a player is in check
If the active player’s king is in check:

- the game must internally test the dice-selected piece type for at least one legal move that resolves the check
- a dice result that cannot resolve the check does **not** keep the checked player waiting for another roll
- if the rolled piece type cannot resolve the check, the turn passes to the opponent

### 8.2 What counts as a valid response to check
A move is legal in a check situation only if it removes the check condition according to traditional chess rules.  
This includes any move that:

- moves the king out of check
- blocks the checking line, if the check is from a sliding piece
- captures the attacking piece, if that capture removes the check

### 8.3 Internal validation in check
Even if the dice gives a piece type that seems usable, the game must internally verify that at least one legal move exists that actually resolves the check.

In this context, **legal move** means:

- a move that is legal under traditional chess rules
- and also leaves the king safe after the move

### 8.4 If the dice gives a piece type that cannot resolve check
If the dice result does not allow any legal move that resolves the check:

- the checked player does not get a playable move on that turn
- the turn passes to the opponent immediately
- the opponent may then move according to the same dice-based rules
- this allows the opponent to continue pressure and potentially go for checkmate

### 8.5 If no legal escape exists at all
If the checked player has no legal move that can resolve the check in the current position, then the position is checkmate.

---

## 9. Checkmate and End of Game

If the active player is in check and no legal move exists that can resolve the check, then the position is checkmate.

### Checkmate rule
- If the player cannot legally escape check on the current turn, the game ends.
- The opponent wins.

### Stalemate rule
If the player is not in check but has no legal move available when a legal turn is required, the game may end in stalemate according to standard chess rules.

---

## 10. Promotion, En Passant, and Castling

The game must support the standard chess mechanics below, whenever they are legal in the current position:

### Pawn promotion
- A pawn that reaches the final rank must be promoted according to standard chess rules.
- When a pawn is eligible for promotion, the game must present **four promotion choices**:
  - knight
  - rook
  - bishop
  - queen
- The player must choose one of these four pieces to complete the promotion.

### En passant
- En passant is allowed only when all normal chess conditions for en passant are satisfied.

### Castling
- Castling is allowed only when all standard castling conditions are satisfied.
- If castling is a legal king move and the dice gives the king, the player may be allowed to castle if the position permits it.

---

## 11. Important Internal Rule: Legal Move Search

For every dice result, the engine must internally search the board for legal moves.

This search must consider:

- the current piece type rolled by the dice
- the current board position
- whether the active player is in check
- whether the move obeys traditional chess movement rules
- whether the move leaves the king safe

The dice result is valid only if the search finds at least one legal move for the active player in the current state.

---

## 12. Required Turn Flow Summary

### Normal state
1. Active player rolls dice.
2. Game checks whether that piece type has at least one legal move.
3. If yes, the player may move or skip.
4. If no, turn passes to the opponent.

### Check state
1. Active player rolls dice.
2. Game checks whether that piece type can produce at least one move that resolves the check.
3. If yes, the player may make that move.
4. If no, turn passes to the opponent immediately.
5. If no legal escape exists at all, the game is checkmate.

---

## 13. Key Design Principle

The player should never be blocked from moving a piece when the dice has already granted a piece type that has at least one legal move.

Likewise:

- the game must not switch turns too early
- the game must not hide a legal move from the player
- the game must not allow an illegal move that violates check rules
- the game must always validate move legality internally before changing state

---
