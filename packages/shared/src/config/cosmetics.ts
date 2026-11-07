/*
 * Everything a player can wear, carry or show, and what it costs in coins. The client builds
 * each item from its id; this file is the catalogue every system agrees on.
 */

export type Slot =
  | 'hair'
  | 'hairColor'
  | 'headgear'
  | 'face'
  | 'outfit'
  | 'back'
  | 'accent'
  | 'emote'
  | 'title'
  | 'banner'
  | 'finish'
  | 'weapon';

export type Rarity = 'starter' | 'common' | 'rare' | 'epic' | 'legendary';

export const PRICE: Record<Rarity, number> = { starter: 0, common: 250, rare: 600, epic: 1300, legendary: 2800 };

export interface Item {
  /** `slot:id`, unique across the catalogue. */
  key: string;
  slot: Slot;
  id: string;
  name: string;
  rarity: Rarity;
  price: number;
}

type Row = [id: string, name: string, rarity: Rarity];

const HAIR_ROWS: Row[] = [
  ['fin', 'Crest Fin', 'starter'],
  ['spikes', 'Prism Spikes', 'starter'],
  ['crop', 'Crew Crop', 'starter'],
  ['bob', 'Gloss Bob', 'starter'],
  ['none', 'Clean Dome', 'starter'],
  ['buzz', 'Buzz', 'common'],
  ['fringe', 'Soft Fringe', 'common'],
  ['part', 'Side Part', 'common'],
  ['tails', 'Twin Drips', 'common'],
  ['mohawk', 'Ridge', 'common'],
  ['lowcrest', 'Low Wave', 'common'],
  ['topbun', 'Top Bun', 'common'],
  ['curlcrop', 'Curl Crop', 'common'],
  ['lowtails', 'Low Tails', 'common'],
  ['tallcrest', 'Tall Crest', 'rare'],
  ['frost', 'Frost Tips', 'rare'],
  ['crownspikes', 'Spike Ring', 'rare'],
  ['tallridge', 'Tall Ridge', 'rare'],
  ['liberty', 'Liberty Points', 'rare'],
  ['longbob', 'Long Bob', 'rare'],
  ['curtain', 'Curtain Bob', 'rare'],
  ['pigtails', 'High Pigtails', 'rare'],
  ['pony', 'Ponytail', 'rare'],
  ['spacebuns', 'Space Buns', 'rare'],
  ['lowbun', 'Low Bun', 'rare'],
  ['quiff', 'Quiff', 'rare'],
  ['swoop', 'Side Swoop', 'rare'],
  ['curltop', 'Curl Top', 'rare'],
  ['shoulder', 'Shoulder Sweep', 'rare'],
  ['wild', 'Wild Spikes', 'epic'],
  ['puff', 'Cloud Puff', 'epic'],
  ['pompadour', 'Pompadour', 'epic'],
  ['braid', 'Long Braid', 'epic'],
  ['twinbraids', 'Twin Braids', 'epic'],
  ['long', 'Waterfall', 'epic'],
  ['puffy', 'Puff Tails', 'epic'],
  ['bigpuff', 'Big Puff', 'legendary'],
  ['inferno', 'Inferno Crest', 'legendary'],
];

/** Hair dyes. `team` follows the team's paint. */
export const HAIR_COLORS: Record<string, { color: number; glow?: number; metal?: number }> = {
  team: { color: 0 },
  ink: { color: 0x1d1b24 },
  chestnut: { color: 0x6b3f24 },
  auburn: { color: 0x9a3b1f },
  blonde: { color: 0xe6c36a },
  ash: { color: 0x9b9aa3 },
  snow: { color: 0xf1efea },
  rose: { color: 0xf29bb8 },
  mint: { color: 0x8fe3c4 },
  lilac: { color: 0xb9a2f0 },
  sky: { color: 0x7fc4f5 },
  tangerine: { color: 0xff8a2b },
  lime: { color: 0xa6e33a },
  cobaltdye: { color: 0x2f55e0 },
  bubblegum: { color: 0xff6fc3 },
  gold: { color: 0xd9a21b, metal: 0.7 },
  chrome: { color: 0xc9ced8, metal: 0.9 },
  neon: { color: 0xff3d9a, glow: 0.7 },
  glow: { color: 0x7dff6a, glow: 0.7 },
  void: { color: 0x3b1f73, glow: 0.45 },
  prism: { color: 0xffffff, glow: 0.35, metal: 0.4 },
};

const HAIR_COLOR_ROWS: Row[] = [
  ['team', 'Team Paint', 'starter'],
  ['ink', 'Ink Black', 'starter'],
  ['chestnut', 'Chestnut', 'common'],
  ['auburn', 'Auburn', 'common'],
  ['blonde', 'Wheat', 'common'],
  ['ash', 'Ash', 'common'],
  ['snow', 'Snow', 'common'],
  ['rose', 'Rose', 'common'],
  ['mint', 'Mint', 'common'],
  ['lilac', 'Lilac', 'common'],
  ['sky', 'Sky', 'common'],
  ['tangerine', 'Tangerine', 'rare'],
  ['lime', 'Lime', 'rare'],
  ['cobaltdye', 'Cobalt', 'rare'],
  ['bubblegum', 'Bubblegum', 'rare'],
  ['gold', 'Gold Leaf', 'epic'],
  ['chrome', 'Chrome', 'epic'],
  ['neon', 'Neon Pink', 'epic'],
  ['glow', 'Glow Green', 'epic'],
  ['void', 'Void Violet', 'legendary'],
  ['prism', 'Prism White', 'legendary'],
];

const HEADGEAR_ROWS: Row[] = [
  ['none', 'None', 'starter'],
  ['cap', 'Rooftop Cap', 'starter'],
  ['backcap', 'Backwards Cap', 'common'],
  ['beanie', 'Knit Beanie', 'common'],
  ['sweatband', 'Sweatband', 'common'],
  ['phones', 'Studio Phones', 'common'],
  ['bucket', 'Bucket Hat', 'common'],
  ['beret', 'Beret', 'common'],
  ['bow', 'Hair Bow', 'common'],
  ['slouch', 'Slouch Beanie', 'common'],
  ['catears', 'Cat Ears', 'common'],
  ['partyhat', 'Party Hat', 'common'],
  ['bandana', 'Bandana Wrap', 'common'],
  ['sprout', 'Leaf Sprout', 'common'],
  ['sportvisor', 'Sport Visor', 'common'],
  ['hardhat', 'Hard Hat', 'common'],
  ['flatbrim', 'Flat Brim', 'rare'],
  ['trucker', 'Trucker Cap', 'rare'],
  ['pombeanie', 'Pom Beanie', 'rare'],
  ['tallbeanie', 'Tall Beanie', 'rare'],
  ['muffs', 'Ear Muffs', 'rare'],
  ['headset', 'Comms Headset', 'rare'],
  ['visor', 'Shift Visor', 'rare'],
  ['goggles', 'Aviator Goggles', 'rare'],
  ['fisher', 'Fisher Hat', 'rare'],
  ['painterberet', 'Painter Beret', 'rare'],
  ['bunny', 'Bunny Ears', 'rare'],
  ['bear', 'Bear Ears', 'rare'],
  ['fox', 'Fox Ears', 'rare'],
  ['imp', 'Imp Horns', 'rare'],
  ['antennae', 'Bobble Antennae', 'rare'],
  ['chef', 'Chef Hat', 'rare'],
  ['sunhat', 'Straw Sun Hat', 'rare'],
  ['bikehelmet', 'Bike Helmet', 'rare'],
  ['flower', 'Flower Clip', 'rare'],
  ['longbill', 'Long Bill', 'rare'],
  ['flaps', 'Ear-Flap Beanie', 'rare'],
  ['minitop', 'Mini Top Hat', 'rare'],
  ['halo', 'Chroma Halo', 'epic'],
  ['tophat', 'Top Hat', 'epic'],
  ['tiara', 'Tiara', 'epic'],
  ['rams', 'Ram Horns', 'epic'],
  ['unicorn', 'Unicorn Horn', 'epic'],
  ['propeller', 'Propeller Cap', 'epic'],
  ['wizard', 'Wizard Hat', 'epic'],
  ['tricorn', 'Tricorn', 'epic'],
  ['ranch', 'Ranch Brim', 'epic'],
  ['neonphones', 'Neon Phones', 'epic'],
  ['flowercrown', 'Flower Crown', 'epic'],
  ['cone', 'Traffic Cone', 'epic'],
  ['lightbulb', 'Bright Idea', 'epic'],
  ['crown', 'Crown', 'legendary'],
  ['twinhalo', 'Twin Halo', 'legendary'],
  ['starring', 'Star Ring', 'legendary'],
  ['bubble', 'Space Bubble', 'legendary'],
  ['bucketpaint', 'Paint Bucket', 'legendary'],
  ['cloud', 'Cloud Hat', 'legendary'],
];

const FACE_ROWS: Row[] = [
  ['none', 'None', 'starter'],
  ['round', 'Round Specs', 'common'],
  ['square', 'Square Specs', 'common'],
  ['stripes', 'Cheek Stripes', 'common'],
  ['freckles', 'Freckles', 'common'],
  ['blush', 'Blush', 'common'],
  ['bandaid', 'Band-Aid', 'common'],
  ['pencil', 'Pencil Mustache', 'common'],
  ['nose', 'Clown Nose', 'common'],
  ['cateye', 'Cat-Eye Frames', 'rare'],
  ['shades', 'Tinted Shades', 'rare'],
  ['nerd', 'Taped Specs', 'rare'],
  ['patch', 'Eye Patch', 'rare'],
  ['handlebar', 'Handlebar', 'rare'],
  ['walrus', 'Walrus Mustache', 'rare'],
  ['goatee', 'Goatee', 'rare'],
  ['beard', 'Full Beard', 'rare'],
  ['splatmark', 'Splat Mark', 'rare'],
  ['whiskers', 'Whiskers', 'rare'],
  ['gum', 'Bubble Gum', 'rare'],
  ['tear', 'Ink Tear', 'rare'],
  ['aviators', 'Aviators', 'epic'],
  ['monocle', 'Monocle', 'epic'],
  ['bandanamask', 'Bandana Mask', 'epic'],
  ['warpaint', 'War Paint', 'epic'],
  ['starcheek', 'Star Cheek', 'epic'],
  ['starshades', 'Star Shades', 'legendary'],
  ['heartshades', 'Heart Shades', 'legendary'],
];

const OUTFIT_ROWS: Row[] = [
  ['jacket', 'Track Jacket', 'starter'],
  ['hoodie', 'Splash Hoodie', 'starter'],
  ['tee', 'Paint Tee', 'common'],
  ['tank', 'Tank Top', 'common'],
  ['vest', 'Utility Vest', 'common'],
  ['stripetee', 'Striped Tee', 'common'],
  ['turtleneck', 'Turtleneck', 'common'],
  ['tracksuit', 'Tracksuit', 'common'],
  ['bomber', 'Bomber', 'rare'],
  ['varsity', 'Varsity', 'rare'],
  ['overalls', 'Overalls', 'rare'],
  ['apron', 'Painter Apron', 'rare'],
  ['raincoat', 'Raincoat', 'rare'],
  ['checkhoodie', 'Checker Hoodie', 'rare'],
  ['polkavest', 'Polka Vest', 'rare'],
  ['scarf', 'Scarf Sweater', 'rare'],
  ['suit', 'Flow Suit', 'epic'],
  ['puffer', 'Puffer', 'epic'],
  ['labcoat', 'Lab Coat', 'epic'],
  ['poncho', 'Poncho', 'epic'],
  ['camo', 'Splat Camo', 'epic'],
  ['drip', 'Drip Hoodie', 'epic'],
  ['tux', 'Tuxedo', 'legendary'],
  ['armor', 'Armor Plate', 'legendary'],
];

const BACK_ROWS: Row[] = [
  ['none', 'None', 'starter'],
  ['tank', 'Ink Tank', 'starter'],
  ['backpack', 'Backpack', 'common'],
  ['satchel', 'Satchel', 'common'],
  ['fin', 'Dorsal Fin', 'common'],
  ['flag', 'Pennant', 'common'],
  ['cans', 'Spray Cans', 'common'],
  ['twintanks', 'Twin Tanks', 'rare'],
  ['cape', 'Cape', 'rare'],
  ['roller', 'Back Roller', 'rare'],
  ['brush', 'Giant Brush', 'rare'],
  ['radio', 'Field Radio', 'rare'],
  ['shell', 'Turtle Shell', 'rare'],
  ['balloon', 'Balloon', 'rare'],
  ['gear', 'Gear Wheel', 'rare'],
  ['jetpack', 'Jetpack', 'epic'],
  ['wings', 'Paper Wings', 'epic'],
  ['batwings', 'Bat Wings', 'epic'],
  ['bubbletank', 'Bubble Tank', 'epic'],
  ['butterfly', 'Butterfly Wings', 'legendary'],
  ['ring', 'Back Halo', 'legendary'],
];

export const ACCENT_COLORS: Record<string, number> = {
  graphite: 0x2a2d3a,
  cream: 0xf2ead8,
  cobalt: 0x2f4fd8,
  forest: 0x1f6b4a,
  slate: 0x56607a,
  sand: 0xd8c39a,
  brick: 0xa4442f,
  navy: 0x1d2a55,
  olive: 0x6b7334,
  plum: 0x5d2a5c,
  lagoon: 0x1d8c8f,
  rose: 0xd77a95,
  mustard: 0xd7a52a,
  coral: 0xf0735b,
  mint: 0x7fd8b6,
  lilac: 0xa996e6,
  sky: 0x6fb4ea,
  charcoal: 0x1a1a1f,
  gold: 0xd9a21b,
  crimson: 0xb3122e,
  emerald: 0x109a62,
  ultraviolet: 0x5a2bd6,
  pearl: 0xf3eee8,
  obsidian: 0x101015,
};

const ACCENT_ROWS: Row[] = [
  ['graphite', 'Graphite', 'starter'],
  ['cream', 'Cream', 'starter'],
  ['cobalt', 'Cobalt', 'common'],
  ['forest', 'Forest', 'common'],
  ['slate', 'Slate', 'common'],
  ['sand', 'Sand', 'common'],
  ['brick', 'Brick', 'common'],
  ['navy', 'Navy', 'common'],
  ['olive', 'Olive', 'common'],
  ['plum', 'Plum', 'common'],
  ['lagoon', 'Lagoon', 'common'],
  ['rose', 'Rose', 'common'],
  ['mustard', 'Mustard', 'rare'],
  ['coral', 'Coral', 'rare'],
  ['mint', 'Mint', 'rare'],
  ['lilac', 'Lilac', 'rare'],
  ['sky', 'Sky', 'rare'],
  ['charcoal', 'Charcoal', 'rare'],
  ['gold', 'Gold', 'epic'],
  ['crimson', 'Crimson', 'epic'],
  ['emerald', 'Emerald', 'epic'],
  ['ultraviolet', 'Ultraviolet', 'epic'],
  ['pearl', 'Pearl', 'legendary'],
  ['obsidian', 'Obsidian', 'legendary'],
];

export const SKIN_TONES = [0xf6d3b8, 0xe7b48f, 0xc98b62, 0x9a6440, 0x6b4128, 0x8fd0c8];

/** Seconds each emote plays. */
export const EMOTE_TIME = 2.4;

const EMOTE_ROWS: Row[] = [
  ['wave', 'Wave', 'starter'],
  ['spin', 'Spin', 'starter'],
  ['clap', 'Clap', 'common'],
  ['point', 'Point', 'common'],
  ['shrug', 'Shrug', 'common'],
  ['facepalm', 'Facepalm', 'common'],
  ['stretch', 'Stretch', 'common'],
  ['yawn', 'Yawn', 'common'],
  ['bow', 'Bow', 'common'],
  ['cheer', 'Cheer', 'common'],
  ['jump', 'Hop', 'common'],
  ['sleepy', 'Dozing Off', 'common'],
  ['flex', 'Flex', 'rare'],
  ['salute', 'Salute', 'rare'],
  ['think', 'Think', 'rare'],
  ['heart', 'Heart Hands', 'rare'],
  ['peace', 'Peace', 'rare'],
  ['fistpump', 'Fist Pump', 'rare'],
  ['raiseroof', 'Raise the Roof', 'rare'],
  ['laugh', 'Laugh', 'rare'],
  ['sway', 'Concert Sway', 'rare'],
  ['marching', 'March', 'rare'],
  ['kick', 'Kick', 'rare'],
  ['sit', 'Take a Seat', 'rare'],
  ['kneel', 'Take a Knee', 'rare'],
  ['curtsy', 'Curtsy', 'rare'],
  ['tada', 'Ta-da', 'rare'],
  ['jacks', 'Jumping Jacks', 'rare'],
  ['dance', 'Running Man', 'epic'],
  ['shuffle', 'Shuffle', 'epic'],
  ['twist', 'Twist', 'epic'],
  ['disco', 'Disco Point', 'epic'],
  ['robot', 'Robot', 'epic'],
  ['boxing', 'Shadow Box', 'epic'],
  ['karate', 'Karate Chops', 'epic'],
  ['guitar', 'Air Guitar', 'epic'],
  ['drums', 'Air Drums', 'epic'],
  ['conduct', 'Conductor', 'epic'],
  ['chicken', 'Chicken Dance', 'epic'],
  ['superhero', 'Hero Pose', 'epic'],
  ['strut', 'Runway Strut', 'epic'],
  ['rockon', 'Rock On', 'epic'],
  ['zombie', 'Zombie', 'epic'],
  ['sneak', 'Sneak', 'epic'],
  ['tantrum', 'Tantrum', 'epic'],
  ['swim', 'Freestyle', 'epic'],
  ['windmill', 'Windmill Arms', 'epic'],
  ['lasso', 'Lasso', 'epic'],
  ['twostep', 'Two-Step', 'epic'],
  ['tpose', 'T-Pose', 'legendary'],
  ['dab', 'Dab', 'legendary'],
  ['floss', 'Floss', 'legendary'],
  ['sprinkler', 'Sprinkler', 'legendary'],
  ['moonwalk', 'Moonwalk', 'legendary'],
  ['twirl', 'Pirouette', 'legendary'],
  ['backflip', 'Backflip', 'legendary'],
];

const TITLE_ROWS: Row[] = [
  ['none', 'No title', 'starter'],
  ['rookie', 'Rookie', 'starter'],
  ['splasher', 'Splasher', 'common'],
  ['painter', 'Painter', 'common'],
  ['sprayer', 'Sprayer', 'common'],
  ['roller', 'Roller', 'common'],
  ['drifter', 'Drifter', 'common'],
  ['lookout', 'Lookout', 'common'],
  ['sharpshooter', 'Sharpshooter', 'common'],
  ['backliner', 'Backliner', 'common'],
  ['frontliner', 'Frontliner', 'common'],
  ['tagger', 'Tagger', 'common'],
  ['freshcoat', 'Fresh Coat', 'common'],
  ['weekend', 'Weekend Warrior', 'common'],
  ['teamplayer', 'Team Player', 'common'],
  ['speedy', 'Speedy', 'common'],
  ['hype', 'Hype Squad', 'common'],
  ['softbrush', 'Soft Brush', 'common'],
  ['slinger', 'Ink Slinger', 'rare'],
  ['keeper', 'Turf Keeper', 'rare'],
  ['crawler', 'Wall Crawler', 'rare'],
  ['jumper', 'Puddle Jumper', 'rare'],
  ['thief', 'Colour Thief', 'rare'],
  ['nightshift', 'Night Shift', 'rare'],
  ['hunter', 'Hue Hunter', 'rare'],
  ['royalty', 'Drip Royalty', 'rare'],
  ['ace', 'Spray Ace', 'rare'],
  ['combo', 'Combo Artist', 'rare'],
  ['knight', 'Chroma Knight', 'epic'],
  ['captain', 'Splat Captain', 'epic'],
  ['phantom', 'Neon Phantom', 'epic'],
  ['storm', 'Paint Storm', 'epic'],
  ['breaker', 'Rainbow Breaker', 'epic'],
  ['pro', 'Pigment Pro', 'epic'],
  ['mural', 'Mural Maker', 'epic'],
  ['titan', 'Splash Titan', 'epic'],
  ['legend', 'Living Legend', 'legendary'],
  ['shifter', 'Chromashifter', 'legendary'],
  ['prism', 'Prism Master', 'legendary'],
  ['masterpiece', 'The Masterpiece', 'legendary'],
];

/** Card backgrounds: two colours and a pattern. */
export const BANNERS: Record<string, { a: string; b: string; p: 'plain' | 'stripes' | 'dots' | 'splat' | 'check' | 'waves' | 'diagonal' | 'grid' | 'drip' }> = {
  plain: { a: '#2e2839', b: '#2e2839', p: 'plain' },
  cream: { a: '#e9dfcf', b: '#e9dfcf', p: 'plain' },
  graphitelines: { a: '#2a2d3a', b: '#3a3e4f', p: 'stripes' },
  peachdots: { a: '#f4a582', b: '#f8c8ae', p: 'dots' },
  inknight: { a: '#14121c', b: '#24203a', p: 'grid' },
  berry: { a: '#c2185b', b: '#e04a86', p: 'stripes' },
  lagoondots: { a: '#11747a', b: '#2fd3d0', p: 'dots' },
  sunny: { a: '#f5b700', b: '#ffd24d', p: 'diagonal' },
  limegrid: { a: '#5d8f1f', b: '#9be03c', p: 'grid' },
  violetwaves: { a: '#4b2fa3', b: '#8b72ff', p: 'waves' },
  coral: { a: '#e8604c', b: '#f59a83', p: 'check' },
  steel: { a: '#4b5366', b: '#6c768c', p: 'stripes' },
  mintdots: { a: '#3fae8a', b: '#8fe3c4', p: 'dots' },
  rose: { a: '#c7577a', b: '#ee9ab4', p: 'diagonal' },
  splatparty: { a: '#2b2240', b: '#ff4d94', p: 'splat' },
  dripgold: { a: '#2a2010', b: '#ffc532', p: 'drip' },
  neongrid: { a: '#0c0b14', b: '#2fd3d0', p: 'grid' },
  sunset: { a: '#ff6a3d', b: '#ffc532', p: 'waves' },
  oceandrip: { a: '#0f2a52', b: '#35d0ff', p: 'drip' },
  candy: { a: '#ff8fc8', b: '#fff0f7', p: 'check' },
  forestsplat: { a: '#16331f', b: '#9be03c', p: 'splat' },
  royal: { a: '#2a1a5e', b: '#ffc532', p: 'stripes' },
  galaxy: { a: '#0d0a1f', b: '#8b72ff', p: 'splat' },
  lava: { a: '#2a0c08', b: '#ff5a1f', p: 'drip' },
  aurora: { a: '#0b2b30', b: '#7dff6a', p: 'waves' },
  electric: { a: '#101018', b: '#ffe14d', p: 'check' },
  prismdots: { a: '#1b1630', b: '#ff4d94', p: 'dots' },
  masterpiece: { a: '#f4efe9', b: '#ff4d94', p: 'splat' },
  supernova: { a: '#1a0b2e', b: '#ffd23f', p: 'splat' },
  storm: { a: '#13202e', b: '#2fd3d0', p: 'drip' },
};

const BANNER_ROWS: Row[] = [
  ['plain', 'Plain Board', 'starter'],
  ['cream', 'Cream Plain', 'common'],
  ['graphitelines', 'Graphite Lines', 'common'],
  ['peachdots', 'Peach Dots', 'common'],
  ['inknight', 'Ink Night', 'common'],
  ['berry', 'Berry Stripes', 'common'],
  ['lagoondots', 'Lagoon Dots', 'common'],
  ['sunny', 'Sunny Diagonals', 'common'],
  ['limegrid', 'Lime Grid', 'common'],
  ['violetwaves', 'Violet Waves', 'common'],
  ['coral', 'Coral Check', 'common'],
  ['steel', 'Steel Lines', 'common'],
  ['mintdots', 'Mint Dots', 'common'],
  ['rose', 'Rose Diagonals', 'common'],
  ['splatparty', 'Splat Party', 'rare'],
  ['dripgold', 'Gold Drip', 'rare'],
  ['neongrid', 'Neon Grid', 'rare'],
  ['sunset', 'Sunset Waves', 'rare'],
  ['oceandrip', 'Ocean Drip', 'rare'],
  ['candy', 'Candy Check', 'rare'],
  ['forestsplat', 'Forest Splat', 'rare'],
  ['royal', 'Royal Stripes', 'rare'],
  ['galaxy', 'Galaxy Splat', 'epic'],
  ['lava', 'Lava Drip', 'epic'],
  ['aurora', 'Aurora Waves', 'epic'],
  ['electric', 'Electric Check', 'epic'],
  ['prismdots', 'Prism Dots', 'epic'],
  ['masterpiece', 'Masterpiece', 'legendary'],
  ['supernova', 'Supernova', 'legendary'],
  ['storm', 'Chroma Storm', 'legendary'],
];

/** Weapon finishes: the body colour and how it takes the light. */
export const FINISHES: Record<string, { color: number; metal: number; rough: number; glow?: number; pattern?: 'stripes' | 'camo' | 'marble' | 'galaxy' | 'carbon' }> = {
  factory: { color: 0xe9e6df, metal: 0.15, rough: 0.38 },
  matte: { color: 0x2a2833, metal: 0, rough: 0.9 },
  candy: { color: 0xff7aa8, metal: 0.2, rough: 0.2 },
  mint: { color: 0x9eeccf, metal: 0.1, rough: 0.4 },
  sky: { color: 0x9fd1ff, metal: 0.1, rough: 0.4 },
  blush: { color: 0xf6c3cf, metal: 0.1, rough: 0.45 },
  charcoal: { color: 0x3a3a42, metal: 0.3, rough: 0.5 },
  chrome: { color: 0xdfe4ec, metal: 1, rough: 0.12 },
  camo: { color: 0x6b7a3a, metal: 0, rough: 0.7, pattern: 'camo' },
  stripes: { color: 0xf4efe9, metal: 0.2, rough: 0.35, pattern: 'stripes' },
  carbon: { color: 0x26262c, metal: 0.4, rough: 0.35, pattern: 'carbon' },
  marble: { color: 0xf0ece6, metal: 0.05, rough: 0.25, pattern: 'marble' },
  bubblegum: { color: 0xff9ad5, metal: 0, rough: 0.6 },
  gold: { color: 0xe0b03a, metal: 1, rough: 0.2 },
  neon: { color: 0x4dfff0, metal: 0, rough: 0.3, glow: 0.8 },
  glacier: { color: 0xc9f0ff, metal: 0.3, rough: 0.08, glow: 0.15 },
  lava: { color: 0xff5a1f, metal: 0.1, rough: 0.5, glow: 0.6 },
  galaxy: { color: 0x2a1d5e, metal: 0.3, rough: 0.3, pattern: 'galaxy', glow: 0.25 },
  prism: { color: 0xffffff, metal: 0.6, rough: 0.1, glow: 0.3, pattern: 'marble' },
  obsidian: { color: 0x15141a, metal: 0.8, rough: 0.15, pattern: 'stripes' },
};

const FINISH_ROWS: Row[] = [
  ['factory', 'Factory', 'starter'],
  ['matte', 'Matte Ink', 'common'],
  ['candy', 'Candy Shell', 'common'],
  ['mint', 'Mint', 'common'],
  ['sky', 'Sky', 'common'],
  ['blush', 'Blush', 'common'],
  ['charcoal', 'Charcoal', 'common'],
  ['chrome', 'Chrome', 'rare'],
  ['camo', 'Splat Camo', 'rare'],
  ['stripes', 'Racing Stripes', 'rare'],
  ['carbon', 'Carbon', 'rare'],
  ['marble', 'Marble', 'rare'],
  ['bubblegum', 'Bubblegum', 'rare'],
  ['gold', 'Gold Plate', 'epic'],
  ['neon', 'Neon', 'epic'],
  ['glacier', 'Glacier', 'epic'],
  ['lava', 'Lava', 'epic'],
  ['galaxy', 'Galaxy', 'legendary'],
  ['prism', 'Prism', 'legendary'],
  ['obsidian', 'Obsidian Gold', 'legendary'],
];

/* ------------------------------------------------------------------------------------------------
 * The wider collection. Hand-made pieces above; everything below is built from them, so every new
 * item uses a model that already fits the body:
 *  - colourways (`base~way`) repaint a hat, face piece, back item or outfit in a fixed palette;
 *  - colours, dyes, finishes, banners and titles are combined from a shared hue wheel;
 * * ---------------------------------------------------------------------------------------------- */

const UP: Rarity[] = ['starter', 'common', 'rare', 'epic', 'legendary'];
const atLeast = (a: Rarity, b: Rarity) => (UP.indexOf(a) >= UP.indexOf(b) ? a : b);
const bump = (r: Rarity, n = 1) => UP[Math.min(4, Math.max(1, UP.indexOf(r) + n))];

/** A colourway: main colour, second colour, trim and highlight, plus how it takes the light. */
export interface Colorway {
  name: string;
  rarity: Rarity;
  a: number;
  b: number;
  dark: number;
  light: number;
  metal?: number;
  rough?: number;
  glow?: number;
}

export const COLORWAYS: Record<string, Colorway> = {
  ink: { name: 'Ink', rarity: 'common', a: 0x23252f, b: 0xf3f0ea, dark: 0x101015, light: 0xf3f0ea },
  snow: { name: 'Snow', rarity: 'common', a: 0xf3f0ea, b: 0xc9d6e8, dark: 0x56607a, light: 0xffffff },
  candy: { name: 'Candy', rarity: 'common', a: 0xff8fc8, b: 0xfff0f7, dark: 0xc2185b, light: 0xffffff },
  midnight: { name: 'Midnight', rarity: 'common', a: 0x1d2a55, b: 0x6fb4ea, dark: 0x101015, light: 0xc9d6ff },
  forest: { name: 'Forest', rarity: 'common', a: 0x1f6b4a, b: 0x9be03c, dark: 0x16331f, light: 0xe6ffd0 },
  sunset: { name: 'Sunset', rarity: 'rare', a: 0xff6a3d, b: 0xffc532, dark: 0x5d2a5c, light: 0xfff0e0 },
  ocean: { name: 'Ocean', rarity: 'rare', a: 0x11747a, b: 0x2fd3d0, dark: 0x0f2a52, light: 0xe0fffd },
  lilac: { name: 'Lilac', rarity: 'rare', a: 0xb9a2f0, b: 0xff9ad5, dark: 0x4b2fa3, light: 0xffffff },
  camo: { name: 'Camo', rarity: 'rare', a: 0x6b7334, b: 0x3f4a22, dark: 0x2a2010, light: 0xd8c39a, rough: 0.85 },
  glacier: { name: 'Glacier', rarity: 'rare', a: 0xc9f0ff, b: 0x7fc4f5, dark: 0x2f55e0, light: 0xffffff, rough: 0.12, metal: 0.25 },
  chrome: { name: 'Chrome', rarity: 'epic', a: 0xdfe4ec, b: 0x9aa3b5, dark: 0x2a2d3a, light: 0xffffff, metal: 1, rough: 0.14 },
  gold: { name: 'Gold', rarity: 'epic', a: 0xe0b03a, b: 0xffd23f, dark: 0x3a2a10, light: 0xfff2b0, metal: 1, rough: 0.22 },
  lava: { name: 'Lava', rarity: 'epic', a: 0xff5a1f, b: 0xffc532, dark: 0x2a0c08, light: 0xffe0b0, glow: 0.55 },
  neon: { name: 'Neon', rarity: 'legendary', a: 0x4dfff0, b: 0xff3d9a, dark: 0x0c0b14, light: 0xffffff, glow: 0.8 },
  galaxy: { name: 'Galaxy', rarity: 'legendary', a: 0x3b1f73, b: 0x8b72ff, dark: 0x0d0a1f, light: 0xffd23f, glow: 0.35, metal: 0.3 },
};
const WAYS = Object.keys(COLORWAYS);

/** `cap~gold` → ['cap', 'gold']; a plain id has no colourway. */
export const splitWay = (id: string): [string, string | undefined] => {
  const i = id.indexOf('~');
  return i < 0 ? [id, undefined] : [id.slice(0, i), id.slice(i + 1)];
};

/** Each hand-made piece in `per` colourways, starting at a different one so the shelf mixes. */
function colorways(rows: Row[], per: number): Row[] {
  const out: Row[] = [];
  rows.forEach(([id, name, rarity], i) => {
    if (id === 'none') return;
    for (let k = 0; k < per; k++) {
      const way = WAYS[(i * 3 + k) % WAYS.length], cw = COLORWAYS[way];
      out.push([`${id}~${way}`, `${cw.name} ${name}`, atLeast(bump(rarity, 0), cw.rarity)]);
    }
  });
  return out;
}

const HUES: [string, string, number][] = [
  ['red', 'Red', 0], ['coral', 'Coral', 10], ['orange', 'Orange', 25], ['amber', 'Amber', 38], ['honey', 'Honey', 47],
  ['lemon', 'Lemon', 56], ['lime', 'Lime', 82], ['green', 'Green', 120], ['jade', 'Jade', 145], ['mint', 'Mint', 160],
  ['teal', 'Teal', 175], ['cyan', 'Cyan', 188], ['sky', 'Sky', 200], ['azure', 'Azure', 213], ['blue', 'Blue', 228],
  ['indigo', 'Indigo', 248], ['violet', 'Violet', 266], ['purple', 'Purple', 285], ['magenta', 'Magenta', 310], ['pink', 'Pink', 333],
];
const LIGHT: [string, number][] = [['Pastel', 0.84], ['Light', 0.7], ['', 0.55], ['Deep', 0.4], ['Dark', 0.26]];

/** HSL (0..360, 0..1, 0..1) to 0xRRGGBB. */
export function hsl(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return (f(0) << 16) | (f(8) << 8) | f(4);
}
const words = (...w: string[]) => w.filter(Boolean).join(' ');

// Body colours: every hue at five lightnesses and three saturations.
const SATS: [string, number][] = [['', 0.82], ['Soft', 0.5], ['Dusty', 0.24]];
for (const [hid, hn, h] of HUES)
  LIGHT.forEach(([ln, l], li) =>
    SATS.forEach(([sn, sat], si) => {
      const id = `${hid}${li}${si}`;
      ACCENT_COLORS[id] = hsl(h, sat, l);
      ACCENT_ROWS.push([id, words(ln, sn, hn), si === 2 || li === 0 ? 'rare' : li === 4 && si === 0 ? 'epic' : 'common']);
    }),
  );

// Hair dyes: every hue at five lightnesses, matte, metallic or glowing.
for (const [hid, hn, h] of HUES)
  LIGHT.forEach(([ln, l], li) =>
    ['', 'Metallic', 'Glow'].forEach((fn, fi) => {
      const id = `${hid}${li}${'mxg'[fi]}`;
      const color = hsl(h, 0.75, l);
      HAIR_COLORS[id] = fi === 1 ? { color, metal: 0.75 } : fi === 2 ? { color, glow: 0.6 } : { color };
      HAIR_COLOR_ROWS.push([id, words(ln, hn, fn), bump(fi === 0 ? 'common' : fi === 1 ? 'rare' : 'epic', li === 0 && fi > 0 ? 1 : 0)]);
    }),
  );

// Weapon finishes: every hue in fourteen treatments.
type Finish = (typeof FINISHES)[string];
const TREATMENTS: [string, string, Rarity, (h: number) => Finish][] = [
  ['matte', 'Matte', 'common', (h) => ({ color: hsl(h, 0.55, 0.45), metal: 0, rough: 0.9 })],
  ['gloss', 'Gloss', 'common', (h) => ({ color: hsl(h, 0.8, 0.55), metal: 0.1, rough: 0.2 })],
  ['satin', 'Satin', 'common', (h) => ({ color: hsl(h, 0.6, 0.6), metal: 0.35, rough: 0.45 })],
  ['pastel', 'Pastel', 'common', (h) => ({ color: hsl(h, 0.7, 0.8), metal: 0.05, rough: 0.4 })],
  ['deep', 'Deep', 'common', (h) => ({ color: hsl(h, 0.7, 0.28), metal: 0.2, rough: 0.35 })],
  ['metal', 'Metal', 'rare', (h) => ({ color: hsl(h, 0.55, 0.62), metal: 1, rough: 0.2 })],
  ['stripes', 'Stripe', 'rare', (h) => ({ color: hsl(h, 0.75, 0.55), metal: 0.2, rough: 0.35, pattern: 'stripes' })],
  ['camo', 'Camo', 'rare', (h) => ({ color: hsl(h, 0.4, 0.4), metal: 0, rough: 0.75, pattern: 'camo' })],
  ['carbon', 'Carbon', 'rare', (h) => ({ color: hsl(h, 0.35, 0.22), metal: 0.45, rough: 0.35, pattern: 'carbon' })],
  ['marble', 'Marble', 'rare', (h) => ({ color: hsl(h, 0.45, 0.82), metal: 0.05, rough: 0.25, pattern: 'marble' })],
  ['frost', 'Frost', 'epic', (h) => ({ color: hsl(h, 0.6, 0.82), metal: 0.3, rough: 0.08, glow: 0.15 })],
  ['pearl', 'Pearl', 'epic', (h) => ({ color: hsl(h, 0.35, 0.86), metal: 0.6, rough: 0.12 })],
  ['neon', 'Neon', 'epic', (h) => ({ color: hsl(h, 1, 0.6), metal: 0, rough: 0.3, glow: 0.8 })],
  ['galaxy', 'Galaxy', 'legendary', (h) => ({ color: hsl(h, 0.6, 0.25), metal: 0.3, rough: 0.3, pattern: 'galaxy', glow: 0.25 })],
];
for (const [hid, hn, h] of HUES)
  for (const [tid, tn, rarity, make] of TREATMENTS) {
    FINISHES[`${hid}-${tid}`] = make(h);
    FINISH_ROWS.push([`${hid}-${tid}`, `${hn} ${tn}`, rarity]);
  }

// Card banners: two hues and a pattern.
type Pat = (typeof BANNERS)[string]['p'];
const PATTERNS: [Pat, string][] = [
  ['stripes', 'Stripes'], ['dots', 'Dots'], ['splat', 'Splat'], ['check', 'Check'], ['waves', 'Waves'],
  ['diagonal', 'Diagonals'], ['grid', 'Grid'], ['drip', 'Drip'], ['plain', 'Wash'],
];
const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
for (let i = 0; BANNER_ROWS.length < 300 && i < 2000; i++) {
  const [pid, pn] = PATTERNS[i % PATTERNS.length];
  const A = HUES[(i * 7) % HUES.length], B = HUES[(i * 7 + 3 + (Math.floor(i / 20) % 15)) % HUES.length];
  const night = i % 3 === 0;
  const id = `${A[0]}${B[0]}-${pid}`;
  if (BANNERS[id]) continue;
  BANNERS[id] = { a: css(hsl(A[2], 0.6, night ? 0.14 : 0.5)), b: css(hsl(B[2], 0.85, night ? 0.6 : 0.68)), p: pid };
  BANNER_ROWS.push([id, `${A[1]} ${B[1]} ${pn}`, pid === 'splat' || pid === 'drip' ? (night ? 'epic' : 'rare') : night ? 'rare' : 'common']);
}

// Titles: an adjective and a role.
const ADJ = ['Neon', 'Rapid', 'Silent', 'Cosmic', 'Golden', 'Wild', 'Lucky', 'Fearless', 'Midnight', 'Electric', 'Sneaky', 'Mighty', 'Glossy', 'Turbo', 'Velvet', 'Fizzy'];
const ROLE = ['Splatter', 'Brush', 'Roller', 'Dripper', 'Sprayer', 'Tagger', 'Muralist', 'Inker', 'Dasher', 'Sniper', 'Striker', 'Guardian', 'Artist', 'Shifter', 'Comet', 'Legend'];
const TIERS: Rarity[] = ['common', 'common', 'rare', 'rare', 'epic', 'legendary'];
ADJ.forEach((a, ai) => ROLE.forEach((r, ri) => TITLE_ROWS.push([`${a}${r}`.toLowerCase(), `${a} ${r}`, TIERS[(ai * 5 + ri * 3) % 6]])));

/** Emotes used to come in styles (`wave-spin`); saved ids like that now mean the move itself. */
export const splitEmote = (id: string): [string, string | undefined] => {
  const i = id.indexOf('-');
  return i < 0 ? [id, undefined] : [id.slice(0, i), id.slice(i + 1)];
};

HEADGEAR_ROWS.push(...colorways(HEADGEAR_ROWS, 4));
FACE_ROWS.push(...colorways(FACE_ROWS, 10));
BACK_ROWS.push(...colorways(BACK_ROWS, 14));
OUTFIT_ROWS.push(...colorways(OUTFIT_ROWS, 11));

const ROWS: [Exclude<Slot, 'weapon'>, Row[]][] = [
  ['hair', HAIR_ROWS],
  ['hairColor', HAIR_COLOR_ROWS],
  ['headgear', HEADGEAR_ROWS],
  ['face', FACE_ROWS],
  ['outfit', OUTFIT_ROWS],
  ['back', BACK_ROWS],
  ['accent', ACCENT_ROWS],
  ['emote', EMOTE_ROWS],
  ['title', TITLE_ROWS],
  ['banner', BANNER_ROWS],
  ['finish', FINISH_ROWS],
];

/** Every cosmetic in the catalogue (weapons are listed with the weapons). */
export const COSMETIC_ITEMS: Item[] = ROWS.flatMap(([slot, rows]) =>
  rows.map(([id, name, rarity]) => ({ key: `${slot}:${id}`, slot, id, name, rarity, price: PRICE[rarity] })),
);

const BY_SLOT = new Map<Slot, Item[]>();
for (const it of COSMETIC_ITEMS) {
  if (!BY_SLOT.has(it.slot)) BY_SLOT.set(it.slot, []);
  BY_SLOT.get(it.slot)!.push(it);
}
const KEYS = new Set(COSMETIC_ITEMS.map((i) => i.key));
/** Is `slot:id` in the catalogue? */
export const isItem = (slot: string, id: string) => KEYS.has(`${slot}:${id}`);

export const itemsFor = (slot: Exclude<Slot, 'weapon'>): Item[] => BY_SLOT.get(slot) ?? [];

export interface Cosmetics {
  hair: string;
  hairColor: string;
  headgear: string;
  face: string;
  outfit: string;
  back: string;
  accent: string;
  skin: number;
  /** Body type: 'm' or 'f'. */
  body?: 'm' | 'f';
  /** The first emote on the wheel (kept for older builds and the player card). */
  emote: string;
  /** The emote wheel: eight slots, '' for an empty one. */
  emotes?: string[];
  title: string;
  banner: string;
  finish: string;
}

/** The cosmetic slots a Cosmetics record holds (everything except skin). */
export const COSMETIC_SLOTS = ['hair', 'hairColor', 'headgear', 'face', 'outfit', 'back', 'accent', 'emote', 'title', 'banner', 'finish'] as const;

export const DEFAULT_COSMETICS: Cosmetics = {
  hair: 'fin',
  hairColor: 'team',
  headgear: 'none',
  face: 'none',
  outfit: 'jacket',
  back: 'none',
  accent: 'graphite',
  skin: 1,
  body: 'm',
  emote: 'wave',
  emotes: ['wave', 'spin', '', '', '', '', '', ''],
  title: 'none',
  banner: 'plain',
  finish: 'factory',
};

/** Coerces untrusted cosmetics (network/storage) into a valid set. */
export function sanitizeCosmetics(c: Partial<Cosmetics> | undefined): Cosmetics {
  const out = { ...DEFAULT_COSMETICS };
  for (const slot of COSMETIC_SLOTS) {
    const v = c?.[slot];
    if (typeof v === 'string' && isItem(slot, v)) out[slot] = v;
  }
  // Older saves hold styled emotes (`wave-quick`); keep the move.
  const move = (id: unknown) => (typeof id !== 'string' ? '' : isItem('emote', id) ? id : isItem('emote', splitEmote(id)[0]) ? splitEmote(id)[0] : '');
  if (typeof c?.emote === 'string' && move(c.emote)) out.emote = move(c.emote);
  const wheel = Array.isArray(c?.emotes) ? c.emotes : [out.emote];
  out.emotes = Array.from({ length: WHEEL }, (_, i) => move(wheel[i]));
  out.emote = out.emotes.find(Boolean) ?? 'wave';
  const skin = Number(c?.skin);
  if (Number.isInteger(skin) && skin >= 0 && skin < SKIN_TONES.length) out.skin = skin;
  out.body = c?.body === 'f' ? 'f' : 'm';
  return out;
}

export const WHEEL = 8;

/** The emote a player plays from wheel slot `slot`. */
export const wheelEmote = (c: Cosmetics, slot: number) => c.emotes?.[slot] || c.emote;

export const titleName = (id: string) => (id === 'none' ? '' : (itemsFor('title').find((t) => t.id === id)?.name ?? ''));

/** A varied, deterministic look for a bot, drawn from the whole catalogue. */
export function botLook(seed: number): Cosmetics {
  let h = (seed * 2654435761) >>> 0;
  const next = (n: number) => {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    return h % n;
  };
  const any = (slot: (typeof COSMETIC_SLOTS)[number]) => {
    const list = itemsFor(slot);
    return list[next(list.length)].id;
  };
  return {
    hair: any('hair'),
    hairColor: next(3) === 0 ? 'team' : any('hairColor'),
    headgear: next(3) === 0 ? 'none' : any('headgear'),
    face: next(2) === 0 ? 'none' : any('face'),
    outfit: any('outfit'),
    back: next(2) === 0 ? 'none' : any('back'),
    accent: any('accent'),
    skin: next(SKIN_TONES.length),
    body: next(2) ? 'f' : 'm',
    emote: any('emote'),
    emotes: Array.from({ length: WHEEL }, () => any('emote')),
    title: any('title'),
    banner: any('banner'),
    finish: next(2) === 0 ? 'factory' : any('finish'),
  };
}
