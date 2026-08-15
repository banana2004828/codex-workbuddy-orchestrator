# Optional Sol/Spark/Luna collaboration guidance

This is an opt-in fragment. The installer never writes or overwrites a repository `AGENTS.md` by default. Merge this fragment manually only after reviewing the target repository's existing rules.

- Sol remains responsible for requirements, architecture, security, scope, difficult judgment, integration, and final acceptance.
- Spark may receive only a small, self-contained coding patch or focused test with explicit file ownership and fast acceptance evidence.
- Luna may receive only a bounded, independently verifiable task with explicit file ownership, forbidden paths, deliverables, and evidence.
- Sol, Spark, and Luna must not edit the same file concurrently. Child-agent results are candidates until Sol inspects the diff and reruns proportionate tests.
- Keep WorkBuddy required, CodeBuddy optional, and TRAE disabled unless a separate explicit policy enables a different experiment.
