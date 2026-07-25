# Ajouter un widget

Ce guide couvre l'ajout d'un widget dans la barre latérale droite. Chaque étape est obligatoire sauf
mention contraire. Le widget [`TerminalWidget`](../src/features/terminal/TerminalWidget.tsx) sert de
référence : ouvre ce fichier dans un second onglet et suis sa structure.

## 1. Créer le composant

Crée un dossier `src/features/<widget>/` contenant le composant principal.

Le composant reçoit ses données via des **props** passées par `App.tsx` à travers `RightSidebar.tsx`.
Il ne communique jamais directement avec le backend : toute requête réseau transite par `src/api.ts`.

```tsx
// src/features/<widget>/<Widget>.tsx

export function MonWidget({ workspacePath }: { workspacePath: string }) {
  // État local (formulaires, sélections, erreurs) uniquement.
  // Données persistantes → props depuis App.tsx.
}
```

**Contraintes :**
- Le composant est affiché ou masqué via le rail, mais jamais démonté
- Toute persistence passe par `localStorage` (préfixe `pi-livecraft.`) côté frontend, ou par un module
  `server/features/<widget>/` côté backend
- Les classes CSS sont colocalisées dans `src/features/<widget>/<widget>.css`

## 2. Enregistrer le widget

Ajoute une entrée dans `rightWidgetDefinitions` (`src/features/right-sidebar/right-sidebar.ts`) :

```ts
{ id: 'mon-widget', label: 'Mon widget' },
```

**Ce seul ajout crée automatiquement :**
- Une commande `open-widget-mon-widget` dans la palette
- Un raccourci clavier assignable dans les paramètres (Settings)

Aucune autre inscription n'est nécessaire.

## 3. Brancher dans RightSidebar.tsx

Dans `src/features/right-sidebar/RightSidebar.tsx` :

- **Panneau :** ajoute un rendu conditionnel sur `activeWidget`, en suivant le pattern des widgets
  existants (repère `activeWidget === 'terminal'` dans le fichier). Passe les props reçues
  par `RightSidebar`.
- **Rail :** ajoute un bouton dans la `<div className="right-sidebar-rail">` en reproduisant
  le pattern d'accessibilité (`aria-controls`, `aria-expanded`, `aria-label`) et l'appel à
  `onWidgetSelect`. Si le widget est conditionnel, englobe le bouton dans une garde.
- **`panelLabel` :** ajoute une entrée dans la fonction du même nom pour le label accessible.

## 4. (Optionnel) Transmettre des props depuis App.tsx

Si le widget a besoin de données ou callbacks gérés par `App.tsx` :

- Ajoute les props à l'interface de `RightSidebar`
- Passe-les dans le rendu de `<RightSidebar>` dans `App.tsx`
- Transmets-les au composant dans le panneau (étape 3)

## 5. (Optionnel) Données depuis le backend

Si le widget consomme des données du backend :

### 5a. Fonction API

```ts
// src/api.ts
export async function getMonWidgetData(cwd: string): Promise<MonDataType> {
  return request<MonDataType>(`/api/mon-widget?cwd=${encodeURIComponent(cwd)}`)
}
```

### 5b. Route backend

```ts
// server/backend.ts
if (url.pathname === '/api/mon-widget' && request.method === 'GET') {
  const cwd = decodeURIComponent(params.get('cwd') ?? '')
  if (!cwd) { response.writeHead(400); response.end('Missing cwd'); return }
  const data = await getMonWidgetData(cwd)
  respondJson(response, 200, data)
}
```

### 5c. Types partagés

```ts
// shared/types.ts
export interface MonDataType {
  // …
}
```

### 5d. Module backend (si logique métier)

```ts
// server/features/mon-widget/mon-widget.ts
export async function getMonWidgetData(cwd: string): Promise<MonDataType> {
  // Logique métier, accès fichiers, etc.
}
```

Les modules backend n'exposent pas de routes HTTP — cette responsabilité reste dans `server/backend.ts`.

## Composant utilitaire : WidgetLayout

`WidgetLayout` (`src/features/right-sidebar/WidgetLayout.tsx`) fournit une structure optionnelle
avec header fixe et zone de contenu scrollable :

```tsx
<WidgetLayout header={<div><strong>Mon widget</strong><span>sous-titre</span></div>}>
  {/* contenu scrollable */}
</WidgetLayout>
```

Il est utilisé par le widget d'analyse de session, mais n'est pas obligatoire.

## Récapitulatif des fichiers touchés

| Fichier | Action |
|---|---|
| `src/features/<widget>/<Widget>.tsx` | Créer le composant |
| `src/features/right-sidebar/right-sidebar.ts` | Ajouter `rightWidgetDefinitions` |
| `src/features/right-sidebar/RightSidebar.tsx` | Panneau, rail, `panelLabel` |
| `src/App.tsx` | (optionnel) Props et callbacks |
| `src/api.ts` | (optionnel) Fonction de requête |
| `server/backend.ts` | (optionnel) Route HTTP |
| `shared/types.ts` | (optionnel) Types |
| `server/features/<widget>/` | (optionnel) Logique backend |

## Widget de référence

[`TerminalWidget`](../src/features/terminal/TerminalWidget.tsx) illustre l'état local, l'appel API,
la gestion d'erreur et le pattern header / contenu / footer.
