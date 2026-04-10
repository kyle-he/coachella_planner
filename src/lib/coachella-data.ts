export interface Artist {
  name: string;
  spotifyName?: string;
}

export interface SetTime {
  artist: Artist;
  stage: string;
  day: "friday" | "saturday" | "sunday";
  dayLabel: string;
  startTime: string;
  endTime: string;
}

export const STAGES = [
  "Coachella Stage",
  "Outdoor Theater",
  "Sonora",
  "Gobi",
  "Mojave",
  "Sahara",
  "Yuma",
] as const;

export type Stage = (typeof STAGES)[number];

export const DAYS = [
  { id: "friday" as const, label: "Friday, Apr 10", date: "2026-04-10" },
  { id: "saturday" as const, label: "Saturday, Apr 11", date: "2026-04-11" },
  { id: "sunday" as const, label: "Sunday, Apr 12", date: "2026-04-12" },
];

function s(
  name: string,
  stage: string,
  day: "friday" | "saturday" | "sunday",
  dayLabel: string,
  startTime: string,
  endTime: string,
  spotifyName?: string
): SetTime {
  return { artist: { name, spotifyName }, stage, day, dayLabel, startTime, endTime };
}

const FRI = "friday" as const;
const SAT = "saturday" as const;
const SUN = "sunday" as const;
const FL = "Friday, Apr 10";
const SL = "Saturday, Apr 11";
const UL = "Sunday, Apr 12";

export const SCHEDULE: SetTime[] = [
  // ===================== FRIDAY =====================

  // Coachella Stage
  s("Blood Orange", "Coachella Stage", FRI, FL, "13:00", "14:30"),
  s("Foster the People", "Coachella Stage", FRI, FL, "15:00", "16:15"),
  s("Teddy Swims", "Coachella Stage", FRI, FL, "16:45", "18:00"),
  s("the xx", "Coachella Stage", FRI, FL, "18:45", "20:00", "The xx"),
  s("Sabrina Carpenter", "Coachella Stage", FRI, FL, "21:00", "22:30"),
  s("Anyma presents Æden", "Coachella Stage", FRI, FL, "23:00", "25:00", "Anyma"),

  // Outdoor Theater
  s("Dabeull", "Outdoor Theater", FRI, FL, "13:30", "14:30"),
  s("BINI", "Outdoor Theater", FRI, FL, "15:00", "16:00"),
  s("Ethel Cain", "Outdoor Theater", FRI, FL, "16:30", "17:30"),
  s("Turnstile", "Outdoor Theater", FRI, FL, "18:15", "19:15"),
  s("Disclosure", "Outdoor Theater", FRI, FL, "20:00", "21:30"),

  // Sonora
  s("February", "Sonora", FRI, FL, "13:00", "13:45"),
  s("Carolina Durante", "Sonora", FRI, FL, "14:00", "14:45"),
  s("Cachirula & Loojan", "Sonora", FRI, FL, "15:00", "15:45"),
  s("The Two Lips", "Sonora", FRI, FL, "16:00", "16:45"),
  s("Ninajirachi", "Sonora", FRI, FL, "17:00", "17:45"),
  s("Fleshwater", "Sonora", FRI, FL, "18:00", "18:45"),
  s("Wednesday", "Sonora", FRI, FL, "19:00", "20:00"),
  s("Hot Mulligan", "Sonora", FRI, FL, "20:15", "21:15"),
  s("Not For Radio", "Sonora", FRI, FL, "21:30", "22:30"),

  // Gobi
  s("Bob Baker Marionettes", "Gobi", FRI, FL, "13:00", "14:00"),
  s("NewDad", "Gobi", FRI, FL, "14:30", "15:15"),
  s("Joyce Manor", "Gobi", FRI, FL, "15:45", "16:30"),
  s("Lykke Li", "Gobi", FRI, FL, "17:00", "18:00"),
  s("fakemink", "Gobi", FRI, FL, "18:30", "19:30"),
  s("Creepy Nuts", "Gobi", FRI, FL, "20:00", "21:00"),
  s("Joost", "Gobi", FRI, FL, "21:30", "22:30"),

  // Mojave
  s("CMAT", "Mojave", FRI, FL, "13:30", "14:15"),
  s("Slayyyter", "Mojave", FRI, FL, "14:45", "15:30"),
  s("Devo", "Mojave", FRI, FL, "16:00", "17:00"),
  s("Holly Humberstone", "Mojave", FRI, FL, "17:30", "18:30"),
  s("Moby", "Mojave", FRI, FL, "19:00", "20:00"),
  s("Dijon", "Mojave", FRI, FL, "20:30", "22:00"),

  // Sahara
  s("Youna", "Sahara", FRI, FL, "13:00", "14:00"),
  s("HUGEL", "Sahara", FRI, FL, "14:15", "15:15"),
  s("Marlon Hoffstadt", "Sahara", FRI, FL, "15:30", "16:30"),
  s("Levity", "Sahara", FRI, FL, "17:00", "18:00"),
  s("KATSEYE", "Sahara", FRI, FL, "18:30", "19:30", "Katseye"),
  s("Central Cee", "Sahara", FRI, FL, "20:00", "21:00"),
  s("Sexyy Red", "Sahara", FRI, FL, "21:30", "23:00"),

  // Yuma
  s("Sahar Z", "Yuma", FRI, FL, "13:00", "14:00"),
  s("Jessica Brankka", "Yuma", FRI, FL, "14:00", "15:00"),
  s("Arodes", "Yuma", FRI, FL, "15:00", "16:00"),
  s("Chloe Caillet x Rossi.", "Yuma", FRI, FL, "16:00", "17:00", "Chloe Caillet"),
  s("Prospa", "Yuma", FRI, FL, "17:00", "18:00"),
  s("Groove Armada", "Yuma", FRI, FL, "18:00", "19:15"),
  s("Max Dean x Luke Dean", "Yuma", FRI, FL, "19:15", "20:15"),
  s("Max Styler", "Yuma", FRI, FL, "20:15", "21:15"),
  s("Gordo", "Yuma", FRI, FL, "21:15", "22:30"),
  s("Kettama", "Yuma", FRI, FL, "22:30", "24:00"),

  // ===================== SATURDAY =====================

  // Coachella Stage
  s("Noga Erez", "Coachella Stage", SAT, SL, "14:00", "15:00"),
  s("Addison Rae", "Coachella Stage", SAT, SL, "15:30", "16:30"),
  s("GIVEON", "Coachella Stage", SAT, SL, "17:15", "18:30", "Giveon"),
  s("The Strokes", "Coachella Stage", SAT, SL, "19:15", "20:45"),
  s("Justin Bieber", "Coachella Stage", SAT, SL, "21:30", "23:00"),

  // Outdoor Theater
  s("Los Hermanos Flores", "Outdoor Theater", SAT, SL, "14:00", "15:00"),
  s("Royel Otis", "Outdoor Theater", SAT, SL, "15:30", "16:30"),
  s("PinkPantheress", "Outdoor Theater", SAT, SL, "17:00", "18:00"),
  s("SOMBR", "Outdoor Theater", SAT, SL, "18:30", "19:30"),
  s("Labrinth", "Outdoor Theater", SAT, SL, "20:15", "21:45"),

  // Sonora
  s("Die Spitz", "Sonora", SAT, SL, "13:00", "13:45"),
  s("Freak Slug", "Sonora", SAT, SL, "14:00", "14:45"),
  s("Ecca Vandal", "Sonora", SAT, SL, "15:00", "15:45"),
  s("Mind Enterprises", "Sonora", SAT, SL, "16:00", "16:45"),
  s("Ceremony", "Sonora", SAT, SL, "17:00", "17:45"),
  s("54 Ultra", "Sonora", SAT, SL, "18:00", "18:45"),
  s("rusowsky", "Sonora", SAT, SL, "19:00", "20:00"),
  s("Lambrini Girls", "Sonora", SAT, SL, "20:15", "21:15"),

  // Gobi
  s("WHATMORE", "Gobi", SAT, SL, "13:30", "14:15"),
  s("Geese", "Gobi", SAT, SL, "14:45", "15:30"),
  s("Blondshell", "Gobi", SAT, SL, "16:00", "17:00"),
  s("BIA", "Gobi", SAT, SL, "17:30", "18:30"),
  s("Davido", "Gobi", SAT, SL, "19:00", "20:00"),

  // Mojave
  s("Luisa Sonza", "Mojave", SAT, SL, "14:00", "15:00", "Luísa Sonza"),
  s("Fujii Kaze", "Mojave", SAT, SL, "15:30", "16:30"),
  s("Alex G", "Mojave", SAT, SL, "17:00", "18:00"),
  s("Swae Lee", "Mojave", SAT, SL, "18:30", "19:30"),
  s("David Byrne", "Mojave", SAT, SL, "20:00", "21:00"),
  s("Interpol", "Mojave", SAT, SL, "21:30", "23:00"),

  // Sahara
  s("ZULAN", "Sahara", SAT, SL, "13:30", "14:30"),
  s("Hamdi", "Sahara", SAT, SL, "15:00", "16:00"),
  s("YOUSUKE YUKIMATSU", "Sahara", SAT, SL, "16:15", "17:15", "¥OU$UK€ ¥UK1MAT$U"),
  s("Nine Inch Noize", "Sahara", SAT, SL, "17:45", "19:15", "Nine Inch Nails"),
  s("Taemin", "Sahara", SAT, SL, "19:30", "20:30"),
  s("Adriatique", "Sahara", SAT, SL, "21:00", "22:00"),
  s("REZZ", "Sahara", SAT, SL, "22:30", "24:00"),

  // Yuma
  s("Yamagucci", "Yuma", SAT, SL, "13:00", "14:00"),
  s("GENESI", "Yuma", SAT, SL, "14:00", "15:00"),
  s("Riordan", "Yuma", SAT, SL, "15:00", "16:00"),
  s("SOSA", "Yuma", SAT, SL, "16:00", "17:00"),
  s("Mahmut Orhan", "Yuma", SAT, SL, "17:00", "18:00"),
  s("Bedouin", "Yuma", SAT, SL, "18:00", "19:15"),
  s("Ben Sterling", "Yuma", SAT, SL, "19:15", "20:30"),
  s("Armin van Buuren x Adam Beyer", "Yuma", SAT, SL, "20:30", "21:45", "Armin van Buuren"),
  s("Boys Noize", "Yuma", SAT, SL, "21:45", "23:00"),

  // ===================== SUNDAY =====================

  // Coachella Stage
  s("Little Simz", "Coachella Stage", SUN, UL, "14:00", "15:00"),
  s("Clipse", "Coachella Stage", SUN, UL, "15:30", "16:30"),
  s("Major Lazer", "Coachella Stage", SUN, UL, "17:15", "18:30"),
  s("Young Thug", "Coachella Stage", SUN, UL, "19:15", "20:45"),
  s("Karol G", "Coachella Stage", SUN, UL, "21:30", "23:00"),

  // Outdoor Theater
  s("Wet Leg", "Outdoor Theater", SUN, UL, "14:30", "15:30"),
  s("Laufey", "Outdoor Theater", SUN, UL, "16:00", "17:15"),
  s("BIGBANG", "Outdoor Theater", SUN, UL, "17:45", "19:00"),
  s("FKA twigs", "Outdoor Theater", SUN, UL, "19:45", "21:15", "FKA Twigs"),

  // Sonora
  s("Glitterer", "Sonora", SUN, UL, "13:00", "13:45"),
  s("Los Retros", "Sonora", SUN, UL, "14:00", "14:45"),
  s("Jane Remover", "Sonora", SUN, UL, "15:00", "15:45"),
  s("DRAIN", "Sonora", SUN, UL, "16:00", "16:45"),
  s("French Police", "Sonora", SUN, UL, "17:00", "17:45"),
  s("Model/Actriz", "Sonora", SUN, UL, "18:00", "19:00"),
  s("Black Flag", "Sonora", SUN, UL, "19:15", "20:15"),
  s("ROZ", "Sonora", SUN, UL, "20:30", "21:30"),

  // Gobi
  s("Flowerovlove", "Gobi", SUN, UL, "13:30", "14:15"),
  s("Morat", "Gobi", SUN, UL, "14:45", "15:45"),
  s("The Rapture", "Gobi", SUN, UL, "16:15", "17:15"),
  s("COBRAH", "Gobi", SUN, UL, "17:45", "18:45"),
  s("Tomora", "Gobi", SUN, UL, "19:15", "20:15"),

  // Mojave
  s("Samia", "Mojave", SUN, UL, "13:30", "14:15"),
  s("The Chats", "Mojave", SUN, UL, "14:45", "15:45"),
  s("Suicidal Tendencies", "Mojave", SUN, UL, "16:15", "17:15"),
  s("Gigi Perez", "Mojave", SUN, UL, "17:45", "18:45"),
  s("Oklou", "Mojave", SUN, UL, "19:15", "20:15"),
  s("Iggy Pop", "Mojave", SUN, UL, "20:45", "22:15"),

  // Sahara
  s("BUNT.", "Sahara", SUN, UL, "13:30", "14:30"),
  s("Mochakk", "Sahara", SUN, UL, "15:00", "16:00"),
  s("Worship", "Sahara", SUN, UL, "16:30", "17:30"),
  s("Duke Dumont", "Sahara", SUN, UL, "18:00", "19:00"),
  s("Subtronics", "Sahara", SUN, UL, "19:30", "20:30"),
  s("Kaskade", "Sahara", SUN, UL, "21:00", "22:30"),

  // Yuma
  s("LE YORA", "Yuma", SUN, UL, "13:00", "14:00"),
  s("&friends", "Yuma", SUN, UL, "14:00", "15:00"),
  s("Azzecca", "Yuma", SUN, UL, "15:00", "16:00"),
  s("MESTIZA", "Yuma", SUN, UL, "16:00", "17:00"),
  s("WhoMadeWho", "Yuma", SUN, UL, "17:00", "18:00"),
  s("Röyksopp", "Yuma", SUN, UL, "18:00", "19:15"),
  s("Carlita x Josh Baker", "Yuma", SUN, UL, "19:15", "20:30", "Carlita"),
  s("Green Velvet x AYYBO", "Yuma", SUN, UL, "20:30", "22:00", "Green Velvet"),
];
