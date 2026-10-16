// Brazilian Portuguese (pt-BR) and English (en) localization engine for Heist
import { useEffect, useState } from "react";

export type Language = "en" | "pt-BR";

const STORAGE_KEY = "heist.lang";

const TRANSLATIONS: Record<Language, Record<string, string>> = {
  en: {
    // Navigation & Common
    "lang.name": "English",
    "common.close": "Close",
    "common.back": "Back",
    "common.play": "Play",
    "common.new_game": "New Game",
    "common.undo": "Undo",
    "common.hint": "Hint",
    "common.time": "Time",
    "common.moves": "Moves",
    "common.score": "Score",
    "common.victory": "Victory!",
    "common.defeat": "Defeat",
    "common.restart": "Restart",
    "common.settings": "Settings",

    // Lobby
    "lobby.quick_play": "Quick Play",
    "lobby.free_chips": "Free chips",
    "lobby.top_up": "Top up and play",
    "lobby.change_table": "Change table",
    "lobby.play_online": "Play online",
    "lobby.real_people": "Real people",
    "lobby.first_lesson_sub": "After your first lesson",
    "lobby.solo_arcade": "Solo Arcade",
    "lobby.arcade_sub": "Solitaire, Checkers & Puzzles",
    "lobby.campaign": "Campaign",
    "lobby.how_to_play": "How to play",
    "lobby.the_rules": "The rules",
    "lobby.coach_rules": "Coach game or the rules",
    "lobby.play_money": "Play money only",
    "lobby.privacy": "Privacy",
    "lobby.learn_heist": "🕵️ Learn Multiplayer Heist",
    "lobby.learn_heist_sub": "3-6 player bluffing game. One quick coached hand. Free.",
    "lobby.play_solo_hub": "🃏 Play Solo Arcade & Daily Deals",
    "lobby.play_solo_hub_sub": "Klondike Solitaire, Checkers, Puzzles & more. Instant play.",
    "lobby.have_account": "I already have an account",

    // Table Setup
    "table.your_table": "Your table",
    "table.your_name": "Your name",
    "table.players": "Players",
    "table.table": "Table",
    "table.buy_in": "Buy-in",
    "table.pot": "Pot",
    "table.deal_me_in": "Deal me in",

    // Settings
    "settings.title": "Settings",
    "settings.language": "Language",
    "settings.sound": "Sound",
    "settings.effects": "Effects",
    "settings.music": "Music",
    "settings.haptics": "Haptics",
    "settings.motion": "Motion",
    "settings.alerts": "Turn alerts and invites",

    // Arcade Hub
    "arcade.title_prefix": "CASINO",
    "arcade.title_suffix": "ARCADE HUB",
    "arcade.badge": "Heist Solo Arcade",
    "arcade.tagline": "Single-player card games, roguelikes & logic puzzles. Instant action, anytime.",
    "arcade.bridge_badge": "HEIST MULTIPLAYER",
    "arcade.bridge_title": "Looking for the Main Heist Game?",
    "arcade.bridge_desc": "High-stakes poker bluffing lounge with bots or friends, ranked jobs, and tavern showdowns.",
    "arcade.bridge_btn": "Play Heist ➔",
    "arcade.tab_all": "All Games",
    "arcade.tab_solitaire": "Solitaire",
    "arcade.tab_action": "Roguelike & Fast Action",
    "arcade.tab_puzzle": "Logic & Board Puzzles",
    "arcade.filter_placeholder": "Filter by name or mechanic...",
  },
  "pt-BR": {
    // Navigation & Common
    "lang.name": "Português (Brasil)",
    "common.close": "Fechar",
    "common.back": "Voltar",
    "common.play": "Jogar",
    "common.new_game": "Novo Jogo",
    "common.undo": "Desfazer",
    "common.hint": "Dica",
    "common.time": "Tempo",
    "common.moves": "Movimentos",
    "common.score": "Pontuação",
    "common.victory": "Vitória!",
    "common.defeat": "Derrota",
    "common.restart": "Reiniciar",
    "common.settings": "Configurações",

    // Lobby
    "lobby.quick_play": "Jogo Rápido",
    "lobby.free_chips": "Fichas Grátis",
    "lobby.top_up": "Recarregar fichas e jogar",
    "lobby.change_table": "Mudar de Mesa",
    "lobby.play_online": "Jogar Online",
    "lobby.real_people": "Jogadores reais",
    "lobby.first_lesson_sub": "Após sua primeira lição",
    "lobby.solo_arcade": "Arcade Solo",
    "lobby.arcade_sub": "Paciência, Damas e Puzzles",
    "lobby.campaign": "Campanha",
    "lobby.how_to_play": "Como Jogar",
    "lobby.the_rules": "As regras",
    "lobby.coach_rules": "Treino ou regras do jogo",
    "lobby.play_money": "Apenas dinheiro fictício",
    "lobby.privacy": "Privacidade",
    "lobby.learn_heist": "🕵️ Aprenda Heist Multijogador",
    "lobby.learn_heist_sub": "Blefe de 3 a 6 jogadores. Uma rodada guiada rápida. Grátis.",
    "lobby.play_solo_hub": "🃏 Jogar Arcade Solo & Desafios",
    "lobby.play_solo_hub_sub": "Paciência Klondike, Damas, Puzzles e mais. Jogo instantâneo.",
    "lobby.have_account": "Já tenho uma conta",

    // Table Setup
    "table.your_table": "Sua Mesa",
    "table.your_name": "Seu Nome",
    "table.players": "Jogadores",
    "table.table": "Mesa",
    "table.buy_in": "Entrada",
    "table.pot": "Prêmio",
    "table.deal_me_in": "Distribuir Cartas",

    // Settings
    "settings.title": "Configurações",
    "settings.language": "Idioma",
    "settings.sound": "Som",
    "settings.effects": "Efeitos",
    "settings.music": "Música",
    "settings.haptics": "Vibração / Tato",
    "settings.motion": "Animações",
    "settings.alerts": "Alertas de turno e convites",

    // Arcade Hub
    "arcade.title_prefix": "CASSINO",
    "arcade.title_suffix": "ARCADE HUB",
    "arcade.badge": "Heist Arcade Solo",
    "arcade.tagline": "Jogos de cartas solo, roguelikes e desafios lógicos. Jogue a qualquer hora.",
    "arcade.bridge_badge": "HEIST MULTIJOGADOR",
    "arcade.bridge_title": "Procurando o Jogo Principal Heist?",
    "arcade.bridge_desc": "Mesa de blefe estilo pôquer com amigos ou bots, golpes ranqueados e duelos na taverna.",
    "arcade.bridge_btn": "Jogar Heist ➔",
    "arcade.tab_all": "Todos os Jogos",
    "arcade.tab_solitaire": "Paciência",
    "arcade.tab_action": "Ação Rápida & Roguelike",
    "arcade.tab_puzzle": "Lógica & Tabuleiro",
    "arcade.filter_placeholder": "Filtrar por nome ou mecânica...",
  },
};

export function getLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "pt-BR" || saved === "en") return saved;
    // Autodetect browser language if Brazilian Portuguese
    if (navigator.language?.toLowerCase().startsWith("pt")) {
      return "pt-BR";
    }
  } catch {
    /* fine */
  }
  return "en";
}

export function setLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
    window.dispatchEvent(new CustomEvent("heist-language-change", { detail: lang }));
  } catch {
    /* fine */
  }
}

export function t(key: string, fallback?: string): string {
  const lang = getLanguage();
  return TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.en[key] ?? fallback ?? key;
}

export function useLanguage(): [Language, (lang: Language) => void] {
  const [lang, setLangState] = useState<Language>(getLanguage);

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<Language>;
      if (customEvent.detail) {
        setLangState(customEvent.detail);
      } else {
        setLangState(getLanguage());
      }
    };
    window.addEventListener("heist-language-change", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("heist-language-change", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const update = (newLang: Language) => {
    setLanguage(newLang);
    setLangState(newLang);
  };

  return [lang, update];
}
