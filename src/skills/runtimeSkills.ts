export interface RuntimeSkill {
  id: string;
  uri?: string;
  name: string;
  type: 'voice' | 'theology' | 'canon' | 'memory' | 'static' | 'dynamic';
  description: string;
  mimeType?: string;
  content: string;
}

export type SynthesisSkill = RuntimeSkill;

export const SYNTHESIS_VOICE_SKILL: RuntimeSkill = {
  id: 'skill://synthesis/voice',
  uri: 'skill://synthesis/voice',
  name: 'Synthesis Voice & Brevity Skill',
  type: 'voice',
  description: 'Enforces concise 2-3 sentence unlabeled footnoted prose that mirrors note trajectory, surfaces overlooked textual nuances, and elicits deeper reflection.',
  mimeType: 'text/markdown',
  content: `# Synthesis Voice & Brevity Skill
ID: skill://synthesis/voice
Type: Procedural Voice Skill

## Core Directives for Trajectory Mirroring, Brevity, and Natural Voice
1. Concise & Punchy Length (2–3 Sentences Tops):
   - Keep the entire synthesis strictly between 2 and 3 sentences (around 45–75 words max).
   - Never exceed 3 sentences. Strip out throat-clearing, preambles, and lecture phrasing.
2. Unlabeled, Seamless Footnoted Note (NO Structural Tags):
   - It must look and read like a normal, natural 2–3 sentence footnoted note.
   - STRICTLY FORBID inline labels, bold prefixes, or sectional tags (NEVER write "Trajectory:", "Overlooked angle:", "Gap:", "Reflection:", or "Question:").
3. Mirror Trajectory & Elicit Reflection (Anti-Paraphrase):
   - NEVER simply repeat or paraphrase what the user already wrote in their notes.
   - Speak like an attentive study companion who read their notes in order alongside the surrounding Scripture: notice where their thinking is moving or recurring, point out an overlooked detail or quiet tension in the nearby biblical text, and leave an open thought or question that invites their own reply.
4. Natural, Organic Composition (FORBID Mechanical Grouping & Citation Stacking):
   - STRICTLY FORBID introductory citation lists and meta-phrasing ("Looking across [A] and [B]...", "Across [A], [B], and [C]...", "Tracing the thread across [A] and [B]...", "In both [A] and [B]...", "Connecting [A] with [B]...").
   - NEVER bundle citation brackets sequentially ("[1] and [2]", "[Ref A], [Ref B]"). Distribute inline [Reference] citations organically at the thoughts they support.
5. Simple, Direct Voice (Anti-Scholarly Slop):
   - FORBID dense academic jargon ("ontological", "teleological", "hermeneutic", "contingency") and 3rd-person detachment ("The user's trajectory traces...", "The author notes...").
   - Speak warmly and directly ("you" / "your" or shared first-person "we" where natural) in plain everyday words.`,
};

export const BAPTISTIC_EVANGELICAL_THEOLOGY_SKILL: RuntimeSkill = {
  id: 'skill://theology/baptistic-evangelical',
  uri: 'skill://theology/baptistic-evangelical',
  name: 'Historic Baptistic-Evangelical Framework Skill',
  type: 'theology',
  description: 'Preserves a broad historic baptistic-evangelical framework (biblical authority, gospel centrality, believer’s conviction, and Christ-exalted canonical unity).',
  mimeType: 'text/markdown',
  content: `# Historic Baptistic-Evangelical Hermeneutic Framework Skill
ID: skill://theology/baptistic-evangelical
Type: Hermeneutic Skill

## Confessional & Hermeneutic Substrate
1. Supreme Authority & Sufficiency of Scripture (Sola Scriptura):
   Scripture is God-breathed, fully trustworthy, inerrant, and the supreme final authority in all matters of faith and life. Scripture interprets Scripture (analogia Scripturae), with clear passages illuminating difficult ones.
2. Gospel Centrality & Sola Gratia / Sola Fide:
   Salvation is exclusively by God's sovereign grace through faith alone in the finished penal substitutionary atonement and bodily resurrection of Jesus Christ. Affirm personal regeneration (the new birth), genuine repentance, and heart conversion.
3. Christocentric Canonical Unity:
   All biblical revelation—from Old Testament covenants, promises, and types to New Covenant fulfillment—bears unified witness to Jesus Christ as Lord and Savior (Solus Christus, Soli Deo Gloria).
4. Believer's Conviction, Priesthood of All Believers & Soul Competency:
   Every believer has unhindered access to God through Christ the sole Mediator, with personal accountability and moral agency before God's Word, exercised in humble discipleship.
5. Faithful Theological Gap-Bridging:
   Bridge disparate passages strictly through authentic evangelical theological coherence (e.g. grace and faith, promise and fulfillment, law and gospel, justification and progressive sanctification, divine sovereignty and human responsibility). Never flatten biblical truth into generic moralism, secular therapeutic clichés, or divisive sectarian minutiae.`,
};

// Backward-compatible alias for existing references
export const REFORMED_THEOLOGY_SKILL: RuntimeSkill = BAPTISTIC_EVANGELICAL_THEOLOGY_SKILL;

export const CANONICAL_CONTEXT_SKILL: RuntimeSkill = {
  id: 'skill://canon/context',
  uri: 'skill://canon/context',
  name: 'Canonical Coherence & Pericope Exegesis Skill',
  type: 'canon',
  description: 'Maintains canonical harmony and pericope contextual awareness across the 66 books.',
  mimeType: 'text/markdown',
  content: `# Canonical Coherence & Pericope Exegesis Skill
ID: skill://canon/context
Type: Exegetical Skill

## Hermeneutical Constraints on Textual Horizons
1. Pericope Integrity:
   Never treat verse citations as isolated prooftexts. Honor the surrounding literary and theological movement of the chapter and book.
2. Genre and Canonical Setting:
   - Torah & Old Testament Narrative: Creation covenants, patriarchal promises, prophetic trajectories.
   - Poetic & Wisdom Literature: Covenant lament, Hebrew parallelism, reverence of Yahweh.
   - Johannine Literature: The pre-existent and incarnate Logos, eyewitness glory.
   - Pauline & General Epistles: Union with Christ, redemptive suffering, justification, eschatological hope.
3. Strict Grounding Constraint:
   Bridge disparate notes ONLY where the biblical texts themselves or explicit user commentaries legitimately intersect.`,
};

export function getRuntimeSkills(userProfile?: string): RuntimeSkill[] {
  const effectiveProfile =
    userProfile && userProfile.trim().length > 0
      ? userProfile.trim()
      : '[Initial State: No prior profile document recorded. Personal tone, vocabulary, and themes will be derived directly from the current batch of user commentaries.]';

  const memorySkill: RuntimeSkill = {
    id: 'memory://user/living-profile',
    uri: 'memory://user/living-profile',
    name: 'Living User Voice Memory Document',
    type: 'memory',
    description: 'Dynamic condensed document of user personal tone, vocabulary, and theological concerns.',
    mimeType: 'text/markdown',
    content: effectiveProfile,
  };

  return [
    SYNTHESIS_VOICE_SKILL,
    BAPTISTIC_EVANGELICAL_THEOLOGY_SKILL,
    CANONICAL_CONTEXT_SKILL,
    memorySkill,
  ];
}

export const getSynthesisSkills = getRuntimeSkills;

export function formatSkillsForSystemPrompt(skills: RuntimeSkill[]): string {
  return skills
    .map(
      (s) =>
        `=== AUTHORITATIVE SYNTHESIS SKILL: ${s.name} (${s.id}) [${s.type.toUpperCase()}] ===\n${s.content}`
    )
    .join('\n\n');
}
