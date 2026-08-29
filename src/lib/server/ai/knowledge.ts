// Reference knowledge base injected into the AI Coach's system prompt (see ./assistant.ts). It is
// static consensus material — evidence-based training/nutrition science and peptide pharmacology /
// harm-reduction — so it stays at the stable head of the system prompt and is prompt-cache friendly.
//
// Integrity constraints (enforced by the wording, and by the closing instruction in assistant.ts):
//  - Everything here is general scientific consensus, not personalized medical advice.
//  - The few named references are real, widely-cited papers. The model is instructed NOT to invent
//    citations, authors, journals, or statistics beyond what's stated here.
//  - Peptide content is educational; actual dosing and any medical concern is deferred to a clinician.

export const COACH_KNOWLEDGE = `# Reference knowledge (general scientific consensus — not personalized medical advice)

## Resistance training & hypertrophy
- Progressive overload — gradually increasing load, reps, or sets over time — is the primary driver of strength and muscle adaptation. Track it against the user's logged top sets and estimated 1RM (Epley) trend.
- Volume shows a dose-response relationship with hypertrophy: roughly 10-20 hard sets per muscle group per week is a broadly effective range for trained lifters; ~4-10 sets can suffice for novices or maintenance. Benefits plateau and excess ("junk") volume accumulates fatigue past what a person can recover from (Schoenfeld et al., 2017, dose-response meta-analysis).
- Load/intensity: hypertrophy occurs across a wide load range (~30-85% of 1RM) when sets are taken close to failure; maximal strength is more load-dependent and favors heavier work (~80-95% 1RM, ~1-6 reps).
- Proximity to failure: training within about 0-3 reps in reserve (RIR) drives growth. Going to absolute failure on every set adds fatigue with little extra benefit; 1-3 RIR usually balances stimulus and recovery.
- Frequency: at equated weekly volume, training a muscle ~2x/week is at least as effective as 1x, and spreading volume improves set quality (Schoenfeld et al., 2016, frequency meta-analysis).
- Range of motion: full ROM, especially loading at longer muscle lengths, generally favors hypertrophy. Use a mix of compound and isolation movements.
- Rest intervals: ~1.5-3 minutes between hard sets preserves performance and total volume for both hypertrophy and strength; very short rests cut the volume you can do at a given load.
- Tempo: control the eccentric; extreme slow tempos mostly reduce the load you can move without adding benefit.
- Periodization & autoregulation: linear and undulating periodization both work; adjusting daily load by RPE/RIR matches training to readiness. Deload or take a lighter week when performance, bar speed, or recovery clearly decline.
- Progression schemes: double progression (add reps within a range, then add load), percentage-based, and RPE/RIR-based are all valid. Individual response varies widely — the user's own logged history is the best signal.
- Soreness (DOMS) is not a reliable proxy for muscle growth.

## Nutrition & recovery for training
- Protein: about 1.6 g/kg/day maximizes resistance-training hypertrophy on average, with little added benefit beyond ~2.2 g/kg; higher intakes are safe for healthy individuals and helpful in a calorie deficit. Spreading ~0.3-0.4 g/kg across 3-5 meals is reasonable (Morton et al., 2018, meta-analysis; Helms et al., 2014).
- Energy balance: a modest surplus (~5-15% above maintenance) supports muscle gain; a deficit drives fat loss. Body recomposition is most achievable for novices, returning lifters, or those with higher body fat.
- Rate of change: roughly 0.25-0.5% of body weight gained per week limits fat gain when bulking; ~0.5-1% lost per week helps preserve muscle when cutting. Faster loss risks lean mass — mitigate with high protein and continued resistance training.
- Creatine monohydrate (~3-5 g/day) is among the most evidence-supported supplements for strength and hypertrophy.
- Sleep (~7-9 h) and stress management materially affect recovery, performance, and body composition.

## Peptides — pharmacology & harm reduction (educational, not a prescription)
Framing: several of these are prescription medicines and others are research chemicals whose human evidence is limited or purely preclinical. Present this as education. Defer any decision to start, stop, or change a dose or compound — and anything about side effects, symptoms, interactions, or bloodwork — to a qualified healthcare professional. Never encourage escalating dose or stacking.

- GLP-1 receptor agonists — semaglutide (GLP-1), tirzepatide (GIP/GLP-1 dual agonist), retatrutide (triple agonist, investigational), liraglutide: incretin mimetics that increase satiety, slow gastric emptying, and improve glycemic control, producing weight loss. Standard practice is slow dose titration to limit gastrointestinal side effects (nausea, vomiting, constipation). Rapid weight loss can cause substantial lean-mass loss — resistance training and high protein are protective. These are prescription drugs needing medical supervision; class considerations include GI effects, gallbladder issues, rare pancreatitis, and contraindication with personal/family history of medullary thyroid carcinoma or MEN2.
- BPC-157 ("body protection compound"): a synthetic peptide studied preclinically for gut and tendon/ligament healing. Human clinical evidence is essentially absent and it is not an approved drug; long-term human safety is unknown.
- TB-500 (a thymosin β4 fragment): investigated in animals for tissue repair and angiogenesis; not approved, with limited human safety data.
- Growth-hormone secretagogues — GHRH analogs (sermorelin, tesamorelin, CJC-1295) and ghrelin-mimetics/GHRPs (ipamorelin, GHRP-2/6): stimulate the body's own pulsatile GH/IGF-1 release rather than injecting GH. Tesamorelin is FDA-approved for HIV-associated lipodystrophy. Possible effects: water retention, joint aches, reduced insulin sensitivity, injection-site reactions; caution around IGF-1 elevation.
- GHK-Cu (copper tripeptide): skin, wound-healing, and cosmetic research; usually topical.
- KPV: an α-MSH fragment studied preclinically for anti-inflammatory and gut effects.
- PT-141 (bremelanotide): a melanocortin agonist, FDA-approved (Vyleesi) for hypoactive sexual desire disorder in premenopausal women; side effects include nausea, flushing, and transient blood-pressure increases.
- Melanotan I/II: melanocortin agonists that darken skin; MT-II also affects appetite and libido. Unregulated, with notable safety concerns (nausea, blood-pressure effects, changes to moles/melanocytes).
- AOD-9604: a GH fragment marketed for fat loss with weak and mixed human evidence.

Harm-reduction practicalities (administrative facts, not a dosing prescription):
- Sterile technique: reconstitute with bacteriostatic water, swab the vial top and injection site, use a new sterile syringe each time, and avoid touching the needle.
- Rotate injection sites to reduce local irritation and lipohypertrophy (subcutaneous options include abdomen, love handles, thighs, delts).
- Storage: most reconstituted peptides are refrigerated and have a limited shelf life — track reconstitution and expiry dates (this app does).
- Dispose of needles in a proper sharps container.
- Research-chemical purity and labeling are unregulated; contamination and mislabeling are real risks.
- Anything involving prescription compounds (GLP-1s, GH secretagogues), interactions, or adverse effects warrants a clinician.`;
