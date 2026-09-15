# Earshot — Brand & Design System

**Version 2.0 · 15 septembre 2026 · Document de référence pour humains et IA**

Ce document décrit la direction artistique et l’implémentation du site Earshot. Il est autonome : on peut le joindre à une IA sans lui transmettre la conversation d’origine. Le prompt de reproduction se trouve à la fin.

Les valeurs chiffrées ci-dessous correspondent à cette version du site. Les principes sont transférables à d’autres produits ; le texte, le symbole, les illustrations et le contenu doivent alors être adaptés à leur identité.

## 1. Intention et référence

**Faire ressentir le produit avant d’expliquer son fonctionnement, puis donner immédiatement accès à une expérience réelle.**

Earshot permet de guider un robot par la voix ou par du texte, puis de transformer ces corrections en règles réutilisables. Le design raconte la rencontre entre instinct humain et exécution mécanique.

La référence demandée est [Analogue Agency](https://analogueagency.com/), examinée dans le navigateur : introduction sombre et lumineuse, navigation flottante, typographie sans empattement, révélation du contenu au défilement et alternance de séquences immersives et éditoriales claires.

Nous en reprenons les principes de composition. Le site Earshot possède son propre texte, son propre champ lumineux généré en code et sa véritable simulation. **Ne pas copier les textes, le logo, les vidéos, les projets clients ou les illustrations d’Analogue.**

### Direction à conserver

- Une présence calme et assurée, avec une entrée visuellement forte.
- De très grands titres et de vrais espaces de respiration.
- Un contraste franc entre noir froid et gris clair neutre.
- Une lumière bleutée précise, intégrée au visuel plutôt qu’ajoutée à chaque composant.
- Une navigation courte ; une action principale évidente.
- Un vocabulaire humain, concret et bref.
- Une interface de démonstration qui affiche réellement l’état du produit.

### Direction explicitement abandonnée

La première proposition ivoire / vert sauge, « petit laboratoire » et tableau de bord rempli de cartes n’a pas convenu. **Ne pas revenir à cette proposition.** Éviter les palettes terreuses, les grandes cartes pastel, les petites icônes décoratives omniprésentes et l’accumulation de panneaux marketing.

## 2. Identité de marque

| Élément | Règle |
|---|---|
| Nom affiché | `earshot`, en minuscules dans le logotype |
| Nom rédactionnel | `Earshot` |
| Promesse | L’instinct humain aide une machine à mieux agir et à apprendre |
| Signature principale | `A little human. A lot more possible.` |
| Sous-titre du hero | `Robots learn the moves. You teach them the feeling.` |
| Signature de fin | `The future has a human side.` |
| Langue du site | Anglais ; ce guide est en français |
| Symbole | Petite étoile `✳`, purement graphique ; ce n’est pas une indication de marque déposée |

### Logotype

- Geist Sans, graisse 800 dans la navigation, 750 en pied de page.
- Approche serrée : `letter-spacing: -0.085em` dans la navigation ; `-0.09em` au footer.
- Navigation : 30 px sur ordinateur, 26 px sur petit mobile.
- Le symbole est un petit exposant après le mot, distinct du nom accessible.
- Monochrome : charbon sur la capsule claire, blanc cassé au footer.
- Pas de déformation horizontale, contour, dégradé multicolore ou ombre épaisse.
- Le favicon existant représente le microphone : fond `#101217`, signe `#e9edf5`.

### Ton rédactionnel

Parler de gestes, de situations et de conséquences : « A softer grip », « A little to the left », « Knowing when to stop ». Les titres éditoriaux peuvent être évocateurs ; les commandes doivent être littérales : `Start run`, `Pause`, `Reset`, `Enable mic`, `Send`.

Ne pas promettre de perfection, d’autonomie totale ou de latence garantie sans preuve. Les compteurs, versions de politique et résultats doivent provenir des données. Ne pas inventer de partenaires, de récompenses, de performances ou de témoignages.

## 3. Architecture de la page

Conserver cette séquence et sa différence de rythme :

1. **Introduction immersive** (`#home`). Plein écran sombre, champ lumineux, titre en deux lignes, courte explication et bouton `Enter the experiment`.
2. **Proposition éditoriale** (`#the-idea`). Gris clair, titre ample à gauche, texte plus petit et asymétrique à droite. Faire comprendre le rôle humain.
3. **Expérience réelle** (`#live-demo`). Titre sur fond sombre, puis console opérationnelle (`#experiment`). Les liens d’accès direct ciblent la console, pas le début du texte qui la précède.
4. **Quatre leçons matérielles**. Quatre objets réels associés à quatre qualités : Softness, Precision, Balance, Care. Leurs états sont ceux de la simulation.
5. **Mode d’emploi** (`#how-it-works`). Trois étapes dans des accordéons natifs : Let it try, Trust your instinct, Make the lesson last.
6. **Signature finale**. Fond sombre, un lien pour revenir à la démo, très grand logotype, retour en haut.

La navigation flottante contient seulement `THE DEMO`, le logotype et `THE IDEA`. Elle reste accessible pendant le défilement. L’expérience ne doit jamais être conditionnée à une animation d’introduction obligatoire.

## 4. Palette et tokens

### Surfaces éditoriales claires — `:root`

| Token | Valeur | Usage |
|---|---|---|
| `--bg` | `#f0f0ee` | Fond éditorial principal |
| `--panel` | `#f8f8f6` | Surface claire secondaire |
| `--raised` | `#ffffff` | Surface relevée |
| `--input` | `#e8e8e5` | Champ sur surface claire |
| `--ink` | `#171717` | Texte principal |
| `--muted` | `#656565` | Texte secondaire |
| `--faint` | `#757575` | Métadonnées |
| `--line` | `#17171720` | Séparation subtile |
| `--line-strong` | `#17171740` | Séparation affirmée |
| `--accent` | `#171717` | Action sur fond clair |
| `--accent-soft` | `#1717170c` | Accent discret |

Autres surfaces : méthode `#eaeae7`, fond du hero `#030509`, footer `#090a0c`.

### Interface opérationnelle sombre — `.dark-surface`

| Token | Valeur | Usage |
|---|---|---|
| `--bg` | `#0a0b0e` | Fond de l’expérience |
| `--panel` | `#111216` | Console |
| `--raised` | `#1a1b20` | Boutons secondaires, menus |
| `--input` | `#16171d` | Champs |
| `--ink` | `#e8e9ee` | Texte principal |
| `--muted` | `#989ca7` | Texte secondaire |
| `--faint` | `#848997` | Métadonnées |
| `--line` | `#ffffff18` | Traits intérieurs |
| `--line-strong` | `#ffffff35` | Traits renforcés |
| `--accent` | `#d6e4ff` | Bouton principal et accent bleu glacier |
| `--accent-soft` | `#a3bbeb12` | Fond d’accent |
| `--ok` / `--ok-soft` | `#8ac9a8` / `#8ac9a815` | Succès |
| `--danger` / `--danger-soft` | `#f1897d` / `#f1897d15` | Arrêt, erreur, échec |
| `--info` | `#b7cbee` | Information |

Les huit chiffres hexadécimaux incluent l’alpha. Ne pas remplacer ces fonds translucides par des aplats opaques.

**Règle importante :** les couleurs de surface et de texte se transmettent par les variables CSS. Un bouton principal utilise `background: var(--accent)` et `color: var(--bg)`. Ne pas fixer son texte en blanc : sur le thème sombre, le bouton est clair et le texte doit être sombre.

Le bleu appartient à la lumière et à l’interaction. Le vert appartient au succès, le corail à l’alerte. Ne pas transformer le site en interface entièrement bleue ou en scène multicolore.

## 5. Typographie

Deux familles uniquement : **Geist Sans** pour le langage de marque et les textes ; **Geist Mono** pour les repères, versions, commandes et mesures. Elles sont chargées avec `next/font/google`, avec `display: swap` et des fallbacks système.

| Niveau | Taille / comportement | Graisse | Approche / interligne |
|---|---|---|---|
| Titre du hero | `clamp(54px, 7.8vw, 124px)` | 450 | `-0.075em` / `1.01` |
| Hero ≤ 480 px | `11.8vw` | 450 | `-0.07em` / `1.01` |
| Titre éditorial | `clamp(44px, 5.9vw, 94px)` | 450 | `-0.067em` / `1.02` |
| Titre de l’expérience | `clamp(42px, 5vw, 78px)` | 450 | `-0.06em` / `1.03` |
| Titre de méthode | `clamp(42px, 5vw, 76px)` | 450 | `-0.06em` / `1.03` |
| Titres courts de panneaux | 26–34 px selon largeur | 450 | environ `-0.05em` / `1.1` |
| Paragraphes éditoriaux | 13–15 px | 400 | `1.55–1.75` |
| Texte opérationnel | 10–13 px selon densité | 400–500 | lisible, non condensé |
| Repères décoratifs | 8–10 px, mono | 400 | capitales, approche légère |
| Logotype final | `24vw` | 750 | `-0.09em` / `1.1` |

Les très petits repères sont secondaires : ne jamais y placer une consigne essentielle ou un message d’erreur. Pour une adaptation plus accessible ou destinée à un public différent, augmenter ces microtailles ; préserver la hiérarchie, pas leur petitesse absolue. Vérifier le zoom navigateur à 200 % avant une livraison de production.

Les retours à la ligne sont composés volontairement. Si un `<br>` devient invisible sur mobile, conserver un espace dans le texte pour éviter de coller deux mots. Un seul `h1`, puis des `h2` de section et des `h3` de composant.

## 6. Composition, espacement et formes

### Navigation flottante

- Position fixe, centrée horizontalement.
- Ordinateur : `top: 22px`, largeur `min(500px, calc(100% - 32px))`, hauteur 58 px.
- Padding horizontal 24 px, rayon 20 px.
- Fond `#eeeeead9`, bordure blanche translucide, flou d’arrière-plan 22 px.
- Sur petit mobile : top 16 px, hauteur 52 px, padding 17 px, rayon 16 px.
- Trois éléments équilibrés. Ne pas ajouter une rangée de six liens.

### Grille et respiration

- Hero : `100svh`, minimum 640 px ; minimum 620 px sur petit mobile.
- Contenu éditorial : marges latérales d’environ 5–6 vw.
- Espaces verticaux de grandes sections : 70–130 px ; mobile 40–70 px.
- Section d’idée : grand texte flexible + colonne de 300 px, intervalle 60 px.
- Méthode : deux colonnes, intervalle 8 vw.
- Garder l’asymétrie éditoriale et la différence d’échelle. Ne pas centrer tous les textes.

### Console

- Conteneur sombre, bordure 1 px `#ffffff20`, rayon 13 px.
- Barre de contrôle au-dessus de la scène et du panneau latéral.
- Grille : scène flexible + rail de 325 px ; rail de 385 px à partir de 1600 px.
- Hauteur de base : `clamp(480px, calc(100svh - 174px), 650px)` ; 600 px entre 801 et 1100 px ; 690 px à partir de 1600 px.
- Le formulaire reste en bas du rail ; le journal défile à l’intérieur.
- Les indications de prochaine action se trouvent **sous** la scène. Ne pas masquer les objets avec un grand panneau de texte.
- Cible `#experiment` : `scroll-margin-top: 96px` pour laisser de la place à la navigation.

### Arrondis et traits

Rayons réservés à des rôles précis : navigation 16–20 px, CTA capsule 999 px, console 13 px, petits contrôles 4–6 px. Les sections éditoriales ne sont pas des cartes. Préférer un trait fin et de l’espace à une ombre lourde.

## 7. Composants et comportements

### CTA d’entrée

Capsule transparente sombre, contour discret, texte à gauche et cercle clair contenant une flèche diagonale à droite. Cercle de 37 px ; le fond devient clair au survol et la flèche pivote de 45°. Le lien mène à la vraie console. Aucun bouton sans destination.

### Commandes de simulation

- `Start run` devient `Pause` lorsque la simulation tourne.
- `Reset` conserve le comportement existant du moteur.
- La graine reste modifiable.
- La version active est affichée ; le menu permet d’activer une version existante.
- `Learn from … corrections` utilise le nombre de corrections disponibles ; désactivé quand aucune correction n’est disponible ou pendant l’apprentissage.
- `Guidance on/off` reste un interrupteur avec état accessible.
- Le microphone distingue off, connexion, écoute et erreur. Ne jamais demander son accès au chargement de la page.
- Les fonctions d’import/export et de réinitialisation des données restent dans le menu secondaire.

### Corrections

État vide : motif de barres, titre court, explication, trois suggestions. Une suggestion remplit le brouillon ; **elle ne l’envoie pas automatiquement**.

`Send` et Entrée n’envoient une correction que pendant un run actif ou en pause. Avant le lancement, afficher `Start a run first` et conserver le brouillon. Le journal montre les véritables mots, la commande interprétée, le résultat et le contexte disponible.

### Onglets

Corrections, Policy, Metrics. Soulignement léger pour l’état sélectionné. Flèches gauche/droite, Home et End permettent de les parcourir ; le focus suit l’onglet choisi. Une nouvelle politique ouvre automatiquement le panneau Policy. Ne pas faire reposer l’état uniquement sur la couleur.

### Accordéons

Utiliser `<details>` et `<summary>`. Première étape ouverte initialement. Le signe plus pivote en croix lorsque l’étape est ouverte. Le texte développé explique une action réelle et ses conséquences.

### Illustrations d’objets

Quatre petits SVG locaux : éponge, dévidoir de ruban, marqueur, œuf. Style simple, légèrement volumétrique, palette atténuée. Leur rôle est de reconnaître l’objet ; les titres expriment la qualité à enseigner. Ces SVG sont décoratifs et masqués aux lecteurs d’écran ; le texte et l’état restent accessibles.

## 8. Mouvement et image

### Champ lumineux du hero

L’image principale est générée par `SensoryField.tsx`. **Ce n’est pas une vidéo ni un asset repris d’Analogue.**

- Canvas 2D couvrant le hero, fond `#030509`.
- 180 rayons fins courbés, répartis de manière déterministe.
- 42 ellipses discrètes composent le centre du champ.
- Halos radiaux bleu froid ; aucune palette arc-en-ciel.
- Réaction douce au pointeur : cible interpolée avec un facteur `0.035`, déplacement central maximal d’environ 24 px en x et 18 px en y.
- Dessin limité à environ 30 images/s ; DPR limité à 1.5.
- Le dessin animé est suspendu hors du viewport. Les observateurs et événements sont nettoyés au démontage.
- Avec `prefers-reduced-motion: reduce`, afficher un état statique.

Pour un autre projet : inventer une autre métaphore lumineuse cohérente avec le produit — propagation, onde, lentille, diffraction — tout en gardant la sobriété et la lisibilité.

### Apparitions

Hero : 1.2 s, arrivée de 20 px et flou initial de 5 px, délais gradués de 0.1 à 0.65 s. Révélations de section : 0.9 s, translation de 26 px, seuil d’intersection 0.12, une seule fois.

Survols : environ 0.2–0.3 s. Défilement natif doux, aucun détournement de la molette. En mouvement réduit : supprimer l’animation et le défilement doux ; tout contenu doit rester visible.

### Scène robotique

- Rendu réel React Three Fiber / Three.js.
- Fond et brouillard `#0c1018`, sol `#11151e`, plateau gris métallique `#9da6b4`.
- Carters aluminium clair, pièces sombres, détails de fixation et rainures.
- Éclairage froid de studio, ombres de contact, contraste suffisant pour lire les objets.
- L’environnement de réflexion est généré avec `RoomEnvironment` : pas de téléchargement HDR nécessaire.
- Tone mapping ACES, exposition 1.08 ; DPR du canvas 3D entre 1 et 2.
- Caméra de base `[-33, 51, 92]`, cible `[-1, 4.5, 0]`. Champ de vision adapté au ratio de l’écran.
- Caméra libre facultative ; distance bornée entre 55 et 180 et angle polaire maximal `0.48π`.
- Les couleurs propres des objets peuvent rester chaudes ou naturelles. La palette de marque ne doit pas empêcher de reconnaître une éponge ou un œuf.

## 9. Responsive

| Largeur | Adaptation |
|---|---|
| ≥ 1600 px | Rail 385 px, console plus haute, titres de rail plus grands |
| 1101–1599 px | Console à deux colonnes avec rail 325 px |
| 801–1100 px | Rail 300 px, barre de contrôle autorisée à revenir à la ligne |
| ≤ 800 px | Console en colonne, scène 510 px, rail 540 px, objets sur deux colonnes, sections éditoriales empilées |
| ≤ 480 px | Navigation compacte, hero à 11.8 vw, scène 440 px, contrôles regroupés sur plusieurs lignes |

Ne pas cacher la démo, les corrections ou les erreurs sur mobile. Réduire d’abord les espaces et les métadonnées décoratives. Tester les longs libellés, les versions à plusieurs chiffres et les états chargés. Les cartes d’objets restent dans l’ordre de la simulation.

## 10. Accessibilité et honnêteté de l’interface

- Lien de contournement `Skip to the experiment`, visible au focus.
- Navigation par vrais liens ; commandes par vrais boutons.
- Focus visible ; attributs `aria-label`, `aria-selected`, `aria-pressed`, `aria-checked` selon le rôle.
- Illustrations et champ lumineux décoratifs en `aria-hidden`.
- État, succès et erreur accompagnés de texte.
- Ne pas masquer un message d’erreur pour préserver l’esthétique.
- Ne pas utiliser une animation comme condition d’accès à une fonction.
- Respecter le mouvement réduit et tester le clavier.
- Avant une publication de production : contrôler les contrastes, le zoom 200 % et les zones tactiles. Ce document ne constitue pas une certification WCAG.
- Aucun chiffre inventé. La présence d’une lumière animée ne signifie pas qu’un microphone écoute : seul l’état du microphone le dit.

## 11. Frontière entre design et fonctionnement

**Interdiction de modifier la physique pour obtenir une belle image.**

La refonte porte sur la mise en page, les composants de présentation, les matériaux, l’éclairage, les labels et le cadrage. Conserver le moteur, les collisions, les seuils de prise, les dimensions fonctionnelles, les états des objets, les trajectoires et les paramètres de simulation.

Ne pas modifier pour une demande purement graphique :

- `lib/sim/**` et les constantes physiques ;
- les contrôleurs, la logique de correction et les stores ;
- `components/Scene/hand.ts`, `coords.ts`, `layout3d.ts` ;
- les positions d’objets, la logique de prise/lâcher et les étapes temporelles dans `SimObjects.tsx`.

Un fichier de scène peut contenir du rendu **et** de la logique. Limiter alors l’édition aux propriétés visuelles identifiées. L’animation décorative du hero possède son propre temps et n’écrit jamais dans les stores.

## 12. Carte de l’implémentation

Les chemins suivants sont relatifs à la racine du projet. Le guide reste utilisable sans ces fichiers ; ils permettent d’inspecter ou de modifier l’existant.

| Fichier | Responsabilité |
|---|---|
| `app/globals.css` | Tokens, thèmes, composition, responsive et animations CSS |
| `app/layout.tsx` | Polices et métadonnées |
| `app/icon.svg` | Favicon |
| `components/EarshotApp.tsx` | Structure de page, navigation, sections, anchors et révélations |
| `components/SensoryField.tsx` | Champ lumineux autonome |
| `components/TopBar.tsx` | Contrôles de simulation et menus |
| `components/RightRail.tsx` | Panneau humain et changement d’onglet |
| `components/CorrectionLog.tsx` | Journal, suggestions et saisie |
| `components/Hud.tsx` | État de la scène, transcription et prochaine action |
| `components/Tabs.tsx` | Navigation accessible entre panneaux |
| `components/primitives.tsx` | Boutons, badges et petits composants |
| `components/MetricsPanel.tsx` | Visualisation des résultats réels |
| `components/ObjectGlyph.tsx` | Illustrations des quatre objets |
| `components/Scene/*` | Scène 3D, éclairage et matériaux ; respecter la frontière fonctionnelle |

Stack actuelle : Next.js 16, React 19, TypeScript, Tailwind CSS 4, Zustand, Three.js, React Three Fiber et Drei. Ne pas ajouter une bibliothèque d’animation, un framework de composants ou des assets distants pour reproduire ce qui fonctionne déjà en CSS et canvas natifs. Lire les guides de la version de Next installée dans `node_modules/next/dist/docs/` avant de modifier l’architecture.

## 13. Critères de livraison

- [ ] Le hero, la proposition éditoriale et la console ont trois compositions distinctes.
- [ ] La navigation mène à de vraies destinations et n’occulte pas les commandes.
- [ ] Les titres restent lisibles sans dépendre de l’arrière-plan animé.
- [ ] Aucun débordement horizontal sur ordinateur et mobile.
- [ ] Le robot et les objets sont cadrés ; les labels restent associés au bon objet.
- [ ] La saisie reste accessible avec un journal long.
- [ ] Les états vide, chargé, désactivé et erreur ne cassent pas la grille.
- [ ] Le clavier et le mouvement réduit sont pris en compte.
- [ ] Les données existantes de l’utilisateur sont préservées pendant la vérification.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` et `npm run build` réussissent.
- [ ] Vérification visuelle au moins en 1280×720 et 390×844 ; ajouter un grand écran et le zoom 200 % avant publication de production.
- [ ] Le diff confirme l’absence de changement physique ou fonctionnel non demandé.

## 14. Prompt prêt à donner à une IA

Copier le texte ci-dessous avec ce document complet. Remplacer uniquement les champs entre crochets.

> Tu es designer et développeur front-end. Crée ou adapte [PROJET / PAGE] en suivant le design system Earshot joint.
>
> Objectif produit : [CE QUE LE VISITEUR DOIT COMPRENDRE ET FAIRE].
> Nom et langue : [MARQUE], [LANGUE].
> Fonctionnalités et contraintes à conserver : [LISTE].
> Environnement technique : [STACK ET CHEMIN DU PROJET].
>
> Direction : expérience immersive et éditoriale, noir froid / gris clair neutre, lumière bleu glacier, grands titres sans empattement à approche serrée, navigation flottante courte, sections amples et asymétriques. Une ouverture forte doit mener directement à une fonction réelle. Utilise la lumière et le mouvement avec retenue.
>
> Commence par inspecter l’existant et lire les instructions du dépôt. Définis les tokens et la hiérarchie avant d’implémenter. Conserve les principes, mais adapte la métaphore visuelle et les textes au produit. Ne copie aucun asset, logo ou texte d’Analogue Agency. Ne prétends pas connaître une référence que tu n’as pas consultée.
>
> Évite le tableau de bord pastel, le vert sauge, les cartes répétées, les ombres lourdes, les badges inutiles, les promesses vagues et les statistiques fictives. Aucun contrôle inactif présenté comme opérationnel. Aucun accès microphone automatique.
>
> Pour Earshot : ne touche jamais à la physique, aux paramètres, aux trajectoires ou aux stores pour résoudre un problème visuel. Les animations de marque doivent être indépendantes de la simulation.
>
> Réalise le responsive, les états fonctionnels, le clavier et le mouvement réduit. Vérifie le résultat dans un navigateur, sur ordinateur et mobile. Termine par les contrôles appropriés et un résumé honnête de ce qui a été vérifié et de ce qui reste à vérifier.
>
> Livrables : implémentation terminée, design system à jour avec valeurs effectivement utilisées, liens vers le résultat, et limites connues. Ne qualifie pas le résultat de « parfait » sans validation du commanditaire.
