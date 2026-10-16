// The app shell: loading screens, errors, the in-app-browser gate.
import { strings } from "../define";

export default strings({
  "app.suspended": ["Account suspended", "Conta suspensa"],
  "app.suspendedHelp": ["If you think this is a mistake, email support@playheist.net.", "Se você acha que foi um engano, mande um e-mail pra support@playheist.net."],
  "app.offline": ["Can't reach the vault", "Não deu pra chegar no cofre"],
  "app.offlineText": [
    "The game server didn't answer, maybe it's restarting. Your account and chips are safe, and this page reconnects by itself when it's back.",
    "O servidor do jogo não respondeu, talvez esteja reiniciando. Sua conta e suas fichas estão seguras, e esta página reconecta sozinha quando ele voltar.",
  ],
  "app.tryAgain": ["Try again", "Tentar de novo"],
  "app.opening": ["Opening the vault…", "Abrindo o cofre…"],
  "app.learning": ["Learning to play", "Aprendendo a jogar"],
  "app.campaignStage": ["Campaign, stage {n}", "Campanha, fase {n}"],
  "app.vsBots": ["{n} players vs bots", "{n} jogadores contra bots"],
  "app.keepGoing": ["Keep going →", "Continuar →"],

  "gate.aria": ["Open Heist in your browser", "Abra o Heist no seu navegador"],
  "gate.title": ["Open in your browser", "Abra no seu navegador"],
  "gate.text": ["{app}'s built-in browser can't run Heist properly. It takes two taps to fix:", "O navegador interno do {app} não roda o Heist direito. Dá pra resolver com dois toques:"],
  "gate.chrome": ["Open in Chrome", "Abrir no Chrome"],
  "gate.tap": ["Tap", "Toque em"],
  "gate.corner": ["in the {app} corner.", "no canto do {app}."],
  "gate.cornerShare": ["or the Share button in the {app} corner.", "ou no botão Compartilhar, no canto do {app}."],
  "gate.pick": ["Pick", "Escolha"],
  "gate.safari": ["Open in Safari", "Abrir no Safari"],
  "gate.browser": ["Open in browser", "Abrir no navegador"],
  "gate.copied": ["Link copied. Paste it in your browser", "Link copiado. Cole no seu navegador"],
  "gate.copy": ["Copy the link", "Copiar o link"],
  "gate.anyway": ["Already in your browser? Continue", "Já está no navegador? Continuar"],
});
