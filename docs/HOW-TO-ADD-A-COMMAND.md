# Ajouter une commande

Ce guide couvre l'ajout d'une commande dans la palette et le système de raccourcis clavier.
Chaque étape est obligatoire. La commande `open-palette` sert de référence minimale.

Une commande de widget (barre latérale) est créée automatiquement : voir
[HOW-TO-ADD-A-WIDGET.md](HOW-TO-ADD-A-WIDGET.md).

## 1. Définir la commande

Ajoute l'identifiant dans `CoreCommandId` et l'entrée dans `commandDefinitions`
(`src/features/commands/command-registry.ts`) :

```ts
type CoreCommandId =
  // … existants …
  | 'ma-commande'

export const commandDefinitions: CommandDefinition[] = [
  // … existants …
  { id: 'ma-commande', label: 'Ma commande' },
]
```

L'identifiant devient disponible dans `CommandId` et la commande apparaît dans la palette
sans autre inscription.

## 2. (Optionnel) Ajouter un raccourci par défaut

```ts
export const defaultShortcuts: Partial<Record<CommandId, string>> = {
  // … existants …
  'ma-commande': 'mod+shift+m',
}
```

Les modifieurs utilisent `mod` (Cmd sur Mac, Ctrl sinon), `alt`, `shift`. La normalisation
est gérée par `shortcutFromEvent`. Une commande sans raccourci par défaut reste assignable
depuis les paramètres (Settings).

## 3. Implémenter l'exécution

Dans `src/App.tsx`, ajoute un cas dans la fonction `executeCommand` qui traite le nouvel
identifiant. Repère le pattern existant (`if (id === '...') { …; return }`) et ajoute le
tien à la suite.

## 4. (Optionnel) Rendre la commande conditionnelle

Si la commande n'a de sens que dans certains contextes (session active, données chargées…),
ajoute sa condition de désactivation dans le `useMemo` de `paletteCommands` (`src/App.tsx`).
Repère le champ `disabled` dans le mapping de `commandDefinitions` et ajoute ta condition
aux côtés de `unavailableWidget` et du bloc `['send', 'abort', …]`.

Une commande désactivée reste visible dans la palette mais grisée et non cliquable.

## 5. (Optionnel) Couvrir dans les tests

Ajoute un test dans `test/shortcuts.test.ts` si la commande introduit un nouveau comportement
de normalisation, de conflit de raccourcis, ou de résolution. Pour une commande simple, un
test de présence dans le registre suffit :

```ts
test('ma-commande est reconnue par le registre', () => {
  const definition = commandDefinitions.find((d) => d.id === 'ma-commande')
  assert.ok(definition)
  assert.equal(definition.label, 'Ma commande')
})
```

## Récapitulatif des fichiers touchés

| Fichier | Action |
|---|---|
| `src/features/commands/command-registry.ts` | `CoreCommandId`, `commandDefinitions`, (optionnel) `defaultShortcuts` |
| `src/App.tsx` | `executeCommand`, (optionnel) désactivation dans `paletteCommands` |
| `test/shortcuts.test.ts` | (optionnel) Test de registre |
