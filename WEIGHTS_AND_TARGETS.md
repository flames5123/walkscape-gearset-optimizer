# How Weights & Targets Work

## Single Target

When you pick a single optimization target (e.g. "Reward Rolls" or "XP"), the optimizer finds the gear set that maximizes a raw score for that target. The score formula varies per target but generally follows the pattern:

```
score = (relevant_multipliers) / steps
```

For example, Reward Rolls scores `(1 + double_action) * (1 + double_rewards) / steps`, while XP scores `((base_xp * xp_mult + flat_xp) * da_mult) / steps`.

With a single target there's no weight or normalization involved — the optimizer just maximizes that one number directly.

## Multiple Targets (Composite Scoring)

When you add more than one target row, the optimizer uses a **weighted composite score**. This is where the weight slider and normalization come in.

### The Problem Weights Solve

Different targets produce scores on wildly different scales. XP per step might be in the hundreds, while reward rolls per step might be 0.02. You can't just add `100 * xp_score + 50 * reward_roll_score` because XP would completely dominate due to its larger magnitude.

### Normalization: The 0% to 100% Scale

To make targets comparable, each one is normalized to a 0.0–1.0 scale before weighting:

- **0% (Baseline)** = the score you'd get with **no gear equipped** (naked). Pets, consumables, and collectible passives still count since those aren't gear, but every equipment slot is empty.
- **100% (Max)** = the score from the **best greedy gear set** the optimizer can build for that single target in isolation. It fills every slot with the best available item for that one objective.

The formula is:

```
normalized = (raw_score - baseline) / (max - baseline)
```

So if your current gear set scores 0.015 on reward rolls, the baseline (naked) is 0.005, and the greedy max is 0.025:

```
normalized = (0.015 - 0.005) / (0.025 - 0.005) = 0.5   (50%)
```

This means your gear is halfway between naked and the best possible set for that target.

### How Weights Combine

Each target's weight slider goes from 1% to 100%. The final composite score is:

```
composite = Σ (normalized_score_i × weight_i)
```

The optimizer maximizes this composite score across all targets.

#### Example

Say you set:
- Reward Rolls: weight 100%
- XP: weight 50%

The optimizer scores each candidate gear set as:

```
score = (reward_rolls_normalized × 100) + (xp_normalized × 50)
```

A set that's 80% of max reward rolls and 60% of max XP would score:

```
(0.80 × 100) + (0.60 × 50) = 80 + 30 = 110
```

While a set that's 70% reward rolls but 90% XP would score:

```
(0.70 × 100) + (0.90 × 50) = 70 + 45 = 115  ← wins
```

The weights control how much you care about each target relative to the others. Equal weights = equal priority. A higher weight means the optimizer will sacrifice more of the other targets to improve that one.

### Weight Ratios Matter, Not Absolutes

Setting Reward Rolls to 100% and XP to 50% is the same as setting them to 60% and 30% — it's the ratio (2:1) that matters. The optimizer just multiplies normalized scores by the weights and sums them.

## Available Targets

| Target | What It Maximizes |
|---|---|
| Reward Rolls | Generic loot rolls per step |
| XP | Experience gained per step |
| Chests | Chest drops per step |
| Fine | Fine material drops per step |
| Gems | Gem drops per step |
| Collectibles | Collectible drops per step |
| Coins | Total coin value per step (includes chests + fines) |
| Coins No Chests | Coin value per step, ignoring chest value |
| Coins No Fines | Coin value per step, ignoring fine material value |
| Coins No Chests No Fines | Coin value per step, ignoring both |
| Materials From Input | Output materials per input material (uses double rewards + no materials consumed) |
| Good/Great/Excellent/Perfect/Eternal Per Step | Quality outcome probability per step |
| Eternal Per Input | Eternal quality probability per input material |
| Tokens Per Step | Adventurer's Guild token chance per step |
| Ectoplasm Per Step | Ectoplasm find chance per step |
