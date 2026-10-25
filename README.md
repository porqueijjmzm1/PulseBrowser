# tuff.browse

Navegador para Windows baseado no **Chromium 152** (via Electron 44), com interface própria em português. Antes se chamava **PulseBrowser**.

![logo](src/assets/icon.png)

## Download

Baixe o instalador **tuff.browse-Setup-1.3.0.exe** na página de [Releases](../../releases/latest) (Windows 10/11, 64 bits).

O instalador não tem assinatura digital, então o Windows pode mostrar "O Windows protegeu o computador". Clique em **Mais informações** e depois em **Executar assim mesmo**.

Quem já usava o PulseBrowser não perde nada: na primeira abertura, o tuff.browse move as configurações, o histórico, os favoritos e as senhas para a pasta nova.

## Novidades da versão 1.3

- **Novo nome e logo**: PulseBrowser agora é tuff.browse. As páginas internas usam `tuff://` (endereços `pulse://` antigos continuam funcionando).
- **Extensões do tuff.browse**: extensões próprias que rodam JavaScript e CSS em qualquer site, e até na nova aba. Ficam num botão de quebra-cabeça na barra, como no Chrome, com pop-up, contador no ícone e opção de fixar na barra. Na página `tuff://extensions` dá para criar uma extensão a partir de um modelo, editar os arquivos num editor com destaque de sintaxe, importar uma pasta, duplicar, ligar e desligar, permitir no modo anônimo e ver a documentação da API.
- **Desktop, a nova aba de fábrica**: uma extensão que transforma a nova aba numa área de trabalho. Ícones de vidro líquido (com refração de verdade), dock com efeito de lupa, widgets que você arrasta e redimensiona (relógio, pesquisa, **Spotify embutido**, clima, notas, calendário e mais visitados), papéis de parede (degradês animados, foto do dia do Bing, imagem ou vídeo seu, ou um link), modo de edição com ícones tremendo, arrastar e soltar, seleção em grupo e desfazer. O pop-up da extensão troca o papel de parede na hora.
- **Botão do buscador**: na barra de endereço, mostra qual mecanismo de pesquisa você está usando e troca com um clique (Google, Brave Search, DuckDuckGo, Bing, Perplexity, Startpage, Ecosia e Yahoo).
- **Corretor gramatical em todo lugar**: agora funciona dentro de iframes (editores como TinyMCE e CKEditor), em componentes com shadow DOM, em campos de texto de uma linha e no **Google Docs**.

## Recursos

- **Abas completas**: arrastar para reordenar, fixar, silenciar, duplicar, mover para nova janela, reabrir abas fechadas (Ctrl+Shift+T), fechar outras/à direita e botão do meio para fechar.
- **Barra de endereço inteligente**: sugestões do mecanismo de pesquisa, histórico, favoritos e abas abertas ("Mudar para esta aba"), autocompletar em linha, Alt+Enter (nova aba) e Ctrl+Enter (completa `www.…com`). O botão do buscador fica no canto da barra.
- **tuff Shield**: bloqueador de anúncios, rastreadores, telemetria, golpes e mineradores. Usa as mesmas listas de filtros do uBlock Origin (EasyList, EasyPrivacy, filtros do uBlock, EasyList Portuguese, Peter Lowe e HaGeZi), que são atualizadas sozinhas a cada poucos dias, mais uma lista interna com 11 categorias. Esconde os espaços vazios de anúncio e os avisos de cookies, pula os anúncios do YouTube, limpa parâmetros de rastreamento dos links (`fbclid`, `gclid`, `utm_*`…) e troca scripts de anúncio por versões inofensivas para não quebrar players de vídeo. O pop-up mostra o que foi bloqueado em cada categoria; em Configurações dá para escolher as categorias, as listas e as exceções por site. Faz 99% no [superadblocktest.com](https://superadblocktest.com).
- **Extensões**: extensões do tuff.browse (veja abaixo) e suporte parcial a extensões do Chrome.
- **Corretor gramatical (no estilo do Grammarly)**: sublinha erros de ortografia (vermelho), gramática (amarelo) e estilo (cor de destaque) nas caixas de texto e editores dos sites, inclusive no Google Docs. Ao passar o mouse aparece a correção; o botão no canto do campo lista todas as sugestões, tem "Corrigir tudo" e permite escolher o idioma. Funciona com 25 idiomas e detecção automática, dicionário pessoal, sites desativados, modo rigoroso e correção automática opcional. O texto é verificado pelo [LanguageTool](https://languagetool.org); é possível usar um servidor LanguageTool próprio.
- **Gerenciador de senhas**: oferece para salvar a senha quando você entra em um site e sugere as contas salvas ao clicar no campo de login. As senhas ficam criptografadas com a sua conta do Windows. A página `tuff://passwords` permite buscar, ver, copiar, editar, excluir e adicionar senhas, importar e exportar CSV (Chrome, Edge, Firefox, Opera e Bitwarden) e verificar senhas fracas, repetidas ou vazadas (Have I Been Pwned com k-anonimato).
- **Contas do Google**: botão de perfil na barra com sua foto e um menu com Gmail, Drive, Agenda, YouTube, outras contas, "Adicionar conta" e "Sair".
- **Janela anônima**: sessão separada na memória, apagada quando a última janela anônima é fechada.
- **Favoritos**: barra de favoritos com pastas, gerenciador (`tuff://bookmarks`), importação do Google Chrome e de arquivos HTML, exportação.
- **Histórico** (`tuff://history`) com busca, agrupado por dia, seleção múltipla.
- **Downloads** (`tuff://downloads`): pausar, continuar, cancelar, tentar de novo, progresso no ícone e na barra de tarefas do Windows.
- **Configurações** (`tuff://settings`): tema claro/escuro/sistema, cor de destaque, animações, página inicial, mecanismo de pesquisa, limpar dados de navegação, senhas e contas, corretor gramatical, permissões de sites, pasta de downloads, economia de memória, corretor ortográfico, extensões e "Tornar padrão".
- **Permissões por site**: câmera, microfone, localização, notificações e compartilhamento de tela, com prompts no estilo do Chrome.
- **Segurança**: cadeado e aviso "Não seguro", página de certificado inválido com opção "continuar mesmo assim", páginas internas isoladas (sites não conseguem abri-las nem acessar sua API), CSP nas páginas internas e sandbox em todas as abas.
- **JavaScript Injector** (menu ⋮ › Ferramentas do desenvolvedor): uma janelinha de console para rodar JavaScript na aba aberta, com scripts salvos que podem rodar sozinhos nos sites escolhidos.
- **Animações**: abas que crescem e encolhem, reordenação suave, menus e pop-ups com efeito de mola, barra de progresso de carregamento e notificações animadas. Dá para desligar em Configurações › Aparência, e o navegador respeita a opção de reduzir movimento do Windows.
- **Ferramentas**: DevTools do Chromium encaixadas na janela (F12), inspecionar elemento, código-fonte (Ctrl+U), localizar na página (Ctrl+F), zoom por site, imprimir, salvar como PDF, salvar página completa e capturar a tela da página.
- **Mais**: restauração de sessão com o histórico de cada aba, economia de memória (abas inativas entram em espera), visualizador de PDF, tela cheia de vídeos, picture-in-picture, login HTTP, páginas de erro amigáveis com um minijogo quando a internet cai, lista de atalhos na Jump List do Windows.

## Extensões do tuff.browse

Cada extensão é uma pasta com um `manifest.json`. As suas ficam em `%APPDATA%\tuff.browse\extensions` (botão "Abrir pasta" em `tuff://extensions`); as de fábrica ficam dentro do navegador e podem ser duplicadas para editar.

```json
{
  "name": "Minha extensão",
  "version": "1.0",
  "icon": "icon.svg",
  "content_scripts": [
    { "matches": ["*://*.wikipedia.org/*", "newtab"], "js": ["script.js"], "css": ["style.css"], "run_at": "document_idle" }
  ],
  "action": { "default_popup": "popup.html", "default_title": "Minha extensão" },
  "newtab": "newtab.html",
  "options_page": "options.html"
}
```

- `matches` aceita padrões do Chrome (`<all_urls>`, `*://*.site.com/*`), `newtab` (a nova aba) e `exclude_matches`. `run_at` pode ser `document_start`, `document_end` ou `document_idle`; `"world": "MAIN"` roda junto com o código da página, e `all_frames` inclui os iframes.
- Os scripts (fora do `MAIN`) e as páginas da extensão têm a API `tuff`: `tuff.storage` (dados que ficam salvos), `tuff.fetch` (pedidos para qualquer site, sem CORS), `tuff.tabs`, `tuff.notify`, `tuff.action.setBadge`, `tuff.browser` (buscador e configurações) e `tuff.runtime`. A documentação completa está em `tuff://extensions/#api`.
- Os arquivos da extensão são servidos em `tuff-ext://<id>/arquivo`.

## Como usar

Requer Node.js 22 ou mais recente.

```bash
npm install
npm start
```

### Gerar o instalador do Windows

```bash
npm run dist
```

O instalador é gerado em `dist/tuff.browse-Setup-<versão>.exe`.

> **Atenção:** o NSIS (usado para gerar o instalador) não funciona com caminhos de pasta muito longos (limite de 260 caracteres do Windows). Se o build falhar com `!include: could not open file`, copie o projeto para uma pasta curta (por exemplo `C:\tb`) e rode o comando lá.

Para gerar ícones novos a partir do logo: `npm run icon`.

## Atalhos de teclado

| Ação | Atalho |
| --- | --- |
| Nova aba / janela / janela anônima | Ctrl+T / Ctrl+N / Ctrl+Shift+N |
| Fechar aba / reabrir aba fechada | Ctrl+W / Ctrl+Shift+T |
| Próxima / anterior aba | Ctrl+Tab / Ctrl+Shift+Tab |
| Ir para a aba 1–8 / última | Ctrl+1…8 / Ctrl+9 |
| Barra de endereço | Ctrl+L, Alt+D ou F6 |
| Voltar / avançar | Alt+← / Alt+→ |
| Recarregar / sem cache | F5 / Ctrl+F5 |
| Localizar | Ctrl+F (F3 próximo) |
| Zoom | Ctrl++ / Ctrl+- / Ctrl+0 |
| Favoritar / barra de favoritos / gerenciador | Ctrl+D / Ctrl+Shift+B / Ctrl+Shift+O |
| Histórico / downloads | Ctrl+H / Ctrl+J |
| Imprimir / salvar / capturar | Ctrl+P / Ctrl+S / Ctrl+Shift+S |
| DevTools / código-fonte | F12 / Ctrl+U |
| Tela cheia | F11 |
| Limpar dados de navegação | Ctrl+Shift+Delete |
| Navegar pelas sugestões do corretor ou de login | ↑ / ↓, Enter, Esc |
| Desktop (nova aba): selecionar tudo / apagar / sair da edição | Ctrl+A / Delete / Esc |

## Estrutura

```
src/
  main/       processo principal (janelas, abas, sessões, Shield, extensões, downloads, histórico, favoritos, IPC)
  preload/    pontes seguras (interface e páginas internas) e scripts de senhas, do corretor e das extensões nos sites
  ui/         barra de abas e ferramentas (index.html) e sobreposição de pop-ups (overlay.html)
  pages/      páginas internas tuff:// (nova aba, extensões, histórico, favoritos, downloads, senhas, configurações, sobre, erro)
  extensions/ extensões de fábrica (Desktop)
  shared/     ícones SVG compartilhados
  assets/     ícones do aplicativo
scripts/      geração de ícones
build/        recursos do instalador
```

Os dados do usuário (configurações, histórico, favoritos, sessão, senhas criptografadas, extensões e os dados delas) ficam em `%APPDATA%\tuff.browse`.

### Privacidade do tuff Shield

- As listas de filtros são baixadas dos repositórios oficiais (ou de um espelho no GitHub mantido pela Ghostery) e ficam em `%APPDATA%\tuff.browse\shield`. Nenhuma informação sobre os sites que você visita é enviada.
- O motor de filtros é o [@ghostery/adblocker](https://github.com/ghostery/adblocker) (licença MPL-2.0). As listas têm licenças próprias (GPL-3.0, CC BY-SA e outras) e não vêm junto com o instalador.

### Privacidade do corretor, das contas e do Desktop

- O corretor envia o texto dos campos em que você está escrevendo para a API pública do LanguageTool (`api.languagetool.org`), só depois que você clica no campo e digita. No Google Docs, envia o texto do documento aberto. Campos de senha, de busca, de e-mail, de código e marcados com `spellcheck="false"` nunca são enviados. Para manter o texto no seu computador, rode um [servidor LanguageTool](https://dev.languagetool.org/http-server) e informe o endereço em Configurações › Corretor gramatical, ou desligue o corretor.
- O botão de perfil lê a lista de contas do Google conectadas a partir dos cookies do próprio navegador. Nada é enviado a outros serviços.
- O Desktop busca os ícones dos sites no serviço de favicons do Google, o clima no [Open-Meteo](https://open-meteo.com) (só a cidade escolhida) e a foto do dia no Bing. O Spotify é o player oficial embutido do Spotify.

## Limitações conhecidas

- **Netflix, Spotify Web e outros serviços com DRM (Widevine)** não funcionam: o Electron não inclui o módulo Widevine. Pelo mesmo motivo, o widget do Spotify no Desktop toca prévias de 30 segundos.
- **Extensões do Chrome** têm suporte parcial (scripts de conteúdo e páginas de opções); pop-ups de extensões do Chrome na barra e a Chrome Web Store não funcionam. As extensões do tuff.browse têm pop-up, botão e nova aba.
- No **Google Docs**, o corretor lê o texto pela camada de acessibilidade que o Docs gera para extensões; para aplicar uma sugestão, ele seleciona a palavra com o mouse e digita a correção, como você faria. Só o que aparece na tela (as páginas carregadas) é verificado.
- Em iframes de outros sites dentro de uma página (por exemplo, um editor de comentários hospedado em outro domínio), o corretor funciona, mas o cartão de sugestão fica limitado ao tamanho do iframe.
- Não há sincronização entre dispositivos nem preenchimento automático de endereços e cartões. As senhas salvas ficam só neste computador; use Exportar/Importar para levá-las a outro.
- O login do Google funciona pelo site (como no Firefox). Recursos que dependem do login do próprio Chrome, como a sincronização do Chrome, não estão disponíveis.
- O corretor gramatical usa a API pública gratuita do LanguageTool, que tem limite de uso: textos muito longos (mais de 15 mil caracteres) são verificados só em parte e, se você escrever muito rápido em vários campos, a verificação pode pausar por um minuto.
- A localização (geolocalização) pode não funcionar, pois o serviço do Google exige uma chave de API.
- O tuff Shield não bloqueia o player JW Player (`ssl.p.jwpcdn.com`), só os plugins de anúncio dele, porque muitos sites de notícias usam esse player nos vídeos comuns.
- As categorias opcionais (redes sociais, chat de atendimento, avisos de cookies, testes A/B, rastreadores de erros e afiliados) vêm ligadas. Se um site perder o chat, o botão "Curtir" ou um link de oferta, desligue a categoria em Configurações › tuff Shield ou adicione o site às exceções.
