export const AGE_GROUP_LABELS = {
  AGE_9_11: "9–11 yaş",
  AGE_12_14: "12–14 yaş",
} as const;

export const AVATARS = [
  { key: "deniz", label: "Deniz", emoji: "🌊" },
  { key: "gunes", label: "Güneş", emoji: "☀️" },
  { key: "yildiz", label: "Yıldız", emoji: "⭐" },
  { key: "agac", label: "Ağaç", emoji: "🌳" },
  { key: "kedi", label: "Kedi", emoji: "🐱" },
  { key: "kitap", label: "Kitap", emoji: "📚" },
] as const;

export function avatarEmoji(key: string | null | undefined): string {
  return AVATARS.find((a) => a.key === key)?.emoji ?? "🙂";
}

export const DEFAULT_TIMEZONES = [
  "Europe/Istanbul",
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
] as const;

export const PROMPT_OPTIONS = [
  {
    key: "LIKED" as const,
    label: "Hoşuma giden bir şey",
    question: "Bugün hoşuna giden ne oldu?",
  },
  {
    key: "HARD" as const,
    label: "Zorlandığım bir şey",
    question: "Bugün seni zorlayan ne oldu?",
  },
  {
    key: "LEARNED" as const,
    label: "Öğrendiğim bir şey",
    question: "Bugün ne öğrendin veya fark ettin?",
  },
  {
    key: "TODO" as const,
    label: "Yapmam gereken bir şey",
    question: "Yapman gereken bir şey var mı? Nasıl hissediyorsun?",
  },
  {
    key: "FREE" as const,
    label: "Kendim anlatacağım",
    question: "Bugününü nasıl anlatmak istersin?",
  },
] as const;
