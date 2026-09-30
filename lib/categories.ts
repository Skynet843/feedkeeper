import type { Category, Settings } from './types';

export const CUSTOM_GROUP = 'Custom';

/** Display order of groups in the popup and settings page. */
export const GROUPS = ['Entertainment', 'Lifestyle', 'Current affairs', 'Learning & growth', CUSTOM_GROUP] as const;

type Group = (typeof GROUPS)[number];

const preset = (group: Group, id: string, label: string, description: string, enabled = false): Category => ({
  id,
  label,
  description,
  group,
  enabled,
  builtin: true,
});

// Ids are part of the score cache key and saved selections; when retiring one, map it in REPLACED_BY.
export const BUILTIN_CATEGORIES: Category[] = [
  // Entertainment
  preset('Entertainment', 'comedy', 'Comedy & memes', 'Humor is the main content: stand-up, comedy sketches, roasts, parody, memes, slapstick, funny fails and try-not-to-laugh compilations. Exclude videos that use occasional jokes, playful editing or an amusing premise to explain a subject, demonstrate a skill or document a technical project.', true),
  preset('Entertainment', 'vlogs', 'Vlogs & daily life', 'The creator\'s own life is the content: day-in-my-life and routine vlogs, family, couple and friend-group vlogs, personal updates, study-with-me and work-with-me sessions, outings and trips told as personal diaries, and ASMR or hangout videos where the creator\'s company is the point. Exclude tutorials, reviews and explainers that only use a personal framing.', true),
  preset('Entertainment', 'challenges', 'Challenges, pranks & stunts', 'A challenge, prank or spectacle is the point: 24-hour, last-to-leave and budget-versus challenges, eating and try-not-to-laugh challenges, pranks, dares, social experiments and stunts, contests for prizes, extreme purchases and giveaways, and spectacle builds or makeovers (secret rooms, dream houses, giant tracks) where the reveal and reactions matter more than how it was made. Exclude engineering and maker builds whose substance is design, fabrication and testing, and science experiments that explain what happens.', true),
  preset('Entertainment', 'reactions', 'Reactions & pop culture', 'Reacting to or chatting about pop culture is the main content: reaction videos to clips, trailers, music, memes or other creators, expert reaction series, meme and viral-trend roundups, internet-culture commentary and fandom discussion. Exclude reviews and breakdowns whose substance is evaluating a product, teaching a skill or explaining science, and feuds or scandals, which are Drama & gossip.', true),
  preset('Entertainment', 'drama', 'Drama & gossip', 'Celebrity or influencer personal lives, rumors, interpersonal feuds, relationship speculation, scandal commentary and reality-show disputes are the main subject. Exclude evidence-led investigations into public-interest issues, business misconduct, technology or scientific claims merely because a famous person or controversy is involved.'),
  preset('Entertainment', 'movies_tv', 'Movies, TV & anime', 'Screen fiction and commercial TV: movie, series, anime and reality-show scenes, trailers, recaps, reviews, fan theories, casting and release news, plus reactions to, VFX breakdowns of and analysis of specific films or shows. Exclude factual documentaries and real-world builds merely inspired by a fictional character or prop, filmmaking tutorials about shooting your own videos, and shows or cartoons made for young children, which are Kids content. A cinematic style or a passing movie reference alone is not enough.'),
  preset('Entertainment', 'music', 'Music & dance', 'Music or dance is the main subject: songs, covers, remixes, concerts, performances, choreography, music theory, instrument lessons and dance instruction. Exclude unrelated videos with background music, a brief performance or a music reference. Building an instrument counts when the video features a real performance or lesson, not when the build is the whole story.'),
  preset('Entertainment', 'gaming', 'Gaming', 'Playing or discussing video games: gameplay, lets plays, streams, reviews, trailers and trailer breakdowns, gaming news, analysis of a game\'s graphics, design or story, player strategy, speedruns and esports. Exclude tutorials and devlogs about building games (programming, game engines, making game art) and hardware builds: making a game is software development, not gaming.'),
  preset('Entertainment', 'sports', 'Sports', 'Sports competition, technique and coverage: matches, highlights, sports news, athlete analysis, coaching and sport-specific training. Exclude general fitness, biomechanics or engineering experiments merely featuring an athlete or sports equipment; a substantive sports analysis or coaching lesson still belongs here.'),
  preset('Entertainment', 'podcasts', 'Podcasts & interviews', 'A podcast episode, interview or clip whose primary format is a host-guest conversation or panel discussion. This is a format category and includes educational, technical and news interviews too. Exclude solo explainers, lectures, narrated documentaries and project videos that only contain a brief interview.'),
  preset('Entertainment', 'true_crime', 'True crime & mystery', 'Real criminal cases, criminal investigations, unsolved disappearances, murder narratives, horror stories and paranormal or supernatural mysteries are the main subject. Exclude general forensic-science lessons, scientific unknowns, engineering failure analysis and ordinary uses of words such as mystery or investigation unless a criminal case or horror narrative is central.'),

  // Lifestyle
  preset('Lifestyle', 'lifestyle', 'Food, travel & lifestyle', 'Everyday lifestyle is the main subject: recipes, cooking, food reviews, tourism, travel guides, fashion, beauty, home decor, cleaning, household crafts, home repair and maintenance how-tos, gardening, pet care, dating and relationship advice. Exclude engineering, robotics, electronics, fabrication, inventions and scientific experiments: designing, building or testing a machine is not a household task, even in a home workshop or for a family member.'),
  preset('Lifestyle', 'product_reviews', 'Gadgets, cars & shopping', 'Evaluating consumer products and vehicles: reviews, unboxings, comparisons, buying advice, durability tests, teardowns and repairability assessments of retail products, shopping hauls, car or bike showcases and ownership impressions. A technical explanation of how a product works still counts when it helps judge or choose that product. Exclude custom builds, inventions, robotics projects and electronics lessons that are not about a product people can buy.'),
  preset('Lifestyle', 'health', 'Health & fitness', 'Human health and wellbeing: exercise routines, gym training, diet, nutrition, medical conditions, treatments, rehabilitation and mental-health guidance. Include educational medical explanations. Exclude engineering design or fabrication of a medical or assistive device when the mechanism and build are central; mentioning disability, the body or a patient alone is insufficient.'),
  preset('Lifestyle', 'kids', 'Kids content', 'Content made primarily for young children: nursery rhymes, preschool and early-learning shows, children\'s TV episodes and cartoons, science and educational programmes for children, toy-play stories and simple kids entertainment. Judge the intended audience, not the topic: exclude general-audience science, animation, family vlogs and maker projects merely because children appear or the video is simple or family-friendly.'),
  preset('Lifestyle', 'religion', 'Religion & spirituality', 'Religious belief, practice or spiritual guidance is central: worship, devotional music, sermons, religious mythology, spiritual meditation, astrology and spiritual teachers. Exclude secular history, archaeology, comparative academic study and clinical mindfulness explanations when they examine the subject without devotional or spiritual guidance.'),

  // Current affairs
  preset('Current affairs', 'news', 'News & current affairs', 'Reporting and explanation of current public affairs: news bulletins, breaking and live coverage, press conferences, and explainers or analysis of recent national or world events, government decisions, elections, courts, policy, geopolitics, the economy and markets. Exclude celebrity gossip, film releases, gaming updates and product launches merely labeled news. Historical lessons and technical explainers are not current affairs unless recent public events are central.'),
  preset('Current affairs', 'politics', 'Politics & opinion', 'Political opinion and argument are the main content: partisan commentary and monologues, political debates and shouting-match panels, campaign speeches and rallies, attacks on or praise of politicians and parties, and ideological arguments about social issues. Straight reporting of political events is News & current affairs, though opinionated analysis of current events can be both. Exclude history and civics lessons without a present-day political argument.'),

  // Learning & growth
  preset('Learning & growth', 'education', 'Science & education', 'Substantive learning and investigation: science, mathematics, engineering, history, geography, lectures, courses, exam preparation, technical tutorials, practical skill lessons such as languages, design, filmmaking and writing, and factual documentaries. Include hands-on inventions, maker builds and experiments that show design, fabrication, testing, failures or explanations; these need not be formal lessons or step-by-step courses. Exclude unsupported educational framing on pranks, spectacle, gossip or compilations without substantive explanation. Subject-specific lessons may also match their actual subject category.'),
  preset('Learning & growth', 'tech', 'Tech & programming', 'Computing and engineered technology: programming, AI, software, developer tools, electronics, robotics, hardware design and technical system explanations or demonstrations. Include maker projects that explain their mechanisms, circuits, control systems or development process. Exclude consumer unboxings and buying guides without substantive technical explanation; merely using a computer, gadget or AI tool is insufficient.'),
  preset('Learning & growth', 'finance', 'Money & business', 'Personal finance, investing, markets, crypto, business operations, startups, entrepreneurship, careers, job searches and income advice are the main subject. Exclude technical builds or software tutorials merely because tools cost money, a company is mentioned or a sponsor is present.'),
  preset('Learning & growth', 'motivation', 'Motivation & self-help', 'Explicit advice or speeches about motivation, habits, productivity, mindset, personal growth and life improvement. Exclude an inspiring biography, emotional family story or successful engineering project when motivational advice is not the main substance. Emotional impact alone is not self-help content.'),
];

/** Retired category ids and what replaced them, so old selections carry over; a split selects every part. */
export const REPLACED_BY: Record<string, string[]> = {
  entertainment: ['vlogs', 'challenges', 'reactions'],
  memes: ['comedy'],
  roast: ['comedy'],
  pranks: ['challenges'],
  reaction: ['reactions'],
  asmr: ['vlogs'],
  celebrity: ['drama'],
  reality_tv: ['movies_tv'],
  anime: ['movies_tv'],
  dance: ['music'],
  cricket: ['sports'],
  football: ['sports'],
  fitness: ['health'],
  food: ['lifestyle'],
  travel: ['lifestyle'],
  fashion_beauty: ['lifestyle'],
  animals: ['lifestyle'],
  diy: ['lifestyle'],
  relationships: ['lifestyle'],
  cars: ['product_reviews'],
  business: ['finance'],
  programming: ['tech'],
  science: ['education'],
  history: ['education'],
};

/** Categories split off one that still exists; settings saved before the split follow the original's selection. */
export const SPLIT_FROM: Record<string, string> = {
  politics: 'news',
};

/** Maps saved category ids (profiles, focus sessions) onto the current built-ins. */
export function migrateCategoryIds(ids: string[]): string[] {
  return [...new Set(ids.flatMap((id) => REPLACED_BY[id] ?? [id]))];
}

export function newCustomCategory(label: string, description: string): Category {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'custom';
  return {
    id: `custom_${slug}_${Date.now().toString(36)}`,
    label,
    description,
    group: CUSTOM_GROUP,
    enabled: true,
    builtin: false,
  };
}

/**
 * Questions Jev is asked about a video. A scan asks only what the decision needs: the combined question when it
 * applies (it already carries every selected definition), otherwise each selected category. Why? asks for all.
 */
export function categoriesToScore(s: Settings, inspect = false): Category[] {
  const combined = combinedSelectionCategory(s);
  if (inspect) return combined ? [...s.categories, combined] : s.categories;
  return combined ? [combined] : s.categories.filter((c) => c.enabled);
}

/** Synthetic category used for one direct decision across all selected definitions. */
export const SELECTION_SCORE_ID = '__selected_categories__';

export function combinedSelectionCategory(s: Settings): Category | undefined {
  const selected = s.categories.filter((c) => c.enabled);
  if (s.matchMethod !== 'combined' || selected.length < 2) return undefined;
  return {
    id: SELECTION_SCORE_ID,
    label: 'the selected category set',
    description: selected.map((c) => `${c.label}: ${c.description}`).join('\n'),
    group: 'Decision',
    enabled: true,
    builtin: true,
  };
}

export function groupCategories(cats: Category[]): [string, Category[]][] {
  const byGroup = new Map<string, Category[]>(GROUPS.map((g) => [g, []]));
  for (const c of cats) {
    const g = byGroup.get(c.group) ?? byGroup.get(CUSTOM_GROUP)!;
    g.push(c);
  }
  return [...byGroup].filter(([, list]) => list.length > 0);
}
