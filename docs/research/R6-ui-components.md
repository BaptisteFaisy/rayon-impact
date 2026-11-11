# R6 — Forge UI (React) : composants, contexte produit, i18n

> Document produit pour « Rayon d'impact d'une release » (Codegeist 2026).
> Basé **exclusivement** sur la documentation officielle Atlassian Developer, lue le **2026-11-11**.
> Rien n'est inventé : ce qui n'est pas dans la doc est marqué **« non documenté »**.

---

## 0. Socle : ce qu'est UI Kit (et ce que ce n'est pas)

Source : https://developer.atlassian.com/platform/forge/ui-kit/overview/ — *Last updated Jul 7, 2026*

- UI Kit = framework **React** (`@forge/react`) qui rend des composants **natifs** dans Jira (pas d'iframe).
  Custom UI = app dans une iframe, contrôle total du DOM. Notre spec dit « Forge UI (React) » → **UI Kit**.
- Dépendances : `npm i react@18` + `npm i @forge/react@latest`. La page Components impose **`@forge/react` major ≥ 10**.
- Point d'entrée : `/src/frontend/index.jsx`, rendu par `ForgeReconciler.render(...)` (et **non** `ReactDOM.render`).
- Manifest : `resources: - key: frontend / path: src/frontend/index.tsx`, puis dans chaque module
  `resource: frontend`, `render: native`, `resolver: function: <fn>`.
- **Limite structurante** : « UI Kit relies only on the `@forge/react` components and does not directly rely on
  React DOM. Therefore, functionalities dependent on standard browser DOM elements, like **custom HTML, portals,
  and forwarding refs, may not work** as expected. » → pas de `<div>`, pas de `<a href>` brut, pas de portail,
  pas de `useRef` sur un nœud DOM (hooks reference : `useRef`/`useLayoutEffect` = « limited functionality »).
- Une seule ressource peut servir plusieurs modules via `resources[].entry` (points d'entrée nommés).

---

## 1. Composants disponibles et props principales

Source liste : https://developer.atlassian.com/platform/forge/ui-kit/components/ — *Last updated Jan 29, 2024*
(les props viennent de la page de chaque composant, dates en §1.3)

### 1.1 Catalogue complet (UI Kit « latest »)

| Catégorie | Composants |
|---|---|
| Action | `Button`, `LinkButton`, `LoadingButton`, `ButtonGroup`, `Link` |
| Contenu & image | `AdfRenderer`, `AtlassianIcon` (Preview), `AtlassianTile` (Preview), `Code`, `CodeBlock`, `Comment`, `CommentEditor` (Preview), `DynamicTable`, `Image`, `Icon`, `Tile` (Preview), `User`, `UserGroup`, `Frame` |
| Feedback | `Badge`, `EmptyState`, `Lozenge`, `ProgressBar`, `ProgressTracker`, `SectionMessage` (+ `SectionMessageAction`), `Spinner`, `Tag`, `TagGroup`, `Tooltip` |
| Primitives / layout | `Bleed` (Preview), `Box`, `Inline`, `Pressable` (Preview), `Stack`, `xcss` |
| Navigation | `Breadcrumbs` (Preview), `Pagination` (Preview), `Router` (Preview), `Tabs` (+ `TabList`, `Tab`, `TabPanel`) |
| Overlays | `Modal` (+ `ModalHeader`, `ModalTitle`, `ModalBody`, `ModalFooter`, `ModalTransition`), `Popup` (Preview) |
| Saisie | `Calendar` (Preview), `Checkbox`, `CheckboxGroup`, `DatePicker`, `FilePicker` (EAP), `FileCard` (EAP), `Form` (+ `FormHeader`, `FormSection`, `FormFooter`, `Label`, `HelperMessage`, `ErrorMessage`, `ValidMessage`, `RequiredAsterisk`), `InlineEdit` (Preview), `Radio`, `RadioGroup`, `Range`, `Select`, `TimePicker` (Preview), `TextArea`, `Textfield`, `ChromelessEditor` (Preview), `Toggle`, `UserPicker` |
| Typographie | `Heading`, `List` (Preview), `Text` |
| Graphiques | `BarChart`, `DonutChart`, `HorizontalBarChart`, `HorizontalStackBarChart`, `LineChart`, `PieChart`, `StackBarChart` |

**Traductions de noms (piège n°1)** — les noms de la spec ne sont pas les noms réels :

| Spec | Nom réel UI Kit |
|---|---|
| `StatusLozenge` | **`Lozenge`** (aucun composant `StatusLozenge` dans la doc) |
| `ModalDialog` | **`Modal`** |
| `Table` | **`DynamicTable`** (pas de `Table` simple) |
| `Form/Select/Textarea` | `Form`, `Select`, **`TextArea`** (casse exacte), `Checkbox` |
| `Tabs/TabPanel` | `Tabs` + `TabList` + `Tab` + `TabPanel` |
| `ErrorMessage` | `ErrorMessage` — **exporté depuis la page Form**, pas une page à part |

### 1.2 Props principales (tableau)

| Composant | Props principales (type) |
|---|---|
| `SectionMessage` | `children` (requis), `appearance` `"information"｜"warning"｜"error"｜"success"｜"discovery"`, `title`, `actions` (`SectionMessageAction` ou tableau ; action = `href` **ou** `onClick`) |
| `Lozenge` | `appearance` `"warning"｜"success"｜"discovery"｜"danger"｜"neutral"｜"information"｜AccentColor` (+ legacy `"default"｜"removed"｜"inprogress"｜"moved"｜"new"`), `children` (1–2 mots), `maxWidth` (défaut 200px), `isBold` (déprécié) |
| `Tag` | `text` (requis), `href`, `appearance` `"default"｜"rounded"`, `color` (standard, blue, red, green…), `elemBefore`, `isRemovable`, `removeButtonLabel`, `onBeforeRemoveAction` (retourne bool), `onAfterRemoveAction` |
| `DynamicTable` | `head` (`{cells: HeadCellType[]}`), `rows` (`RowType[]`), `caption`, `isLoading`, `loadingSpinnerSize`, `emptyView`, `rowsPerPage`, `defaultPage`/`page`/`onSetPage`, `defaultSortKey`/`sortKey`/`sortOrder`, `isRankable`/`onRankEnd`, `highlightedRowIndex`, `isFixedSize`, `label` (a11y), `paginationi18n` (`{prev, next, label, pageLabel?}`) |
| `Button` | `appearance` `"default"｜"danger"｜"primary"｜"subtle"｜"warning"`, `onClick`, `isDisabled`, `isSelected`, `spacing` `"compact"｜"default"`, `shouldFitContainer`, `type` `"submit"｜"reset"｜"button"`, `iconBefore`/`iconAfter` |
| `LinkButton` | comme `Button` **sauf `type`** + `href` (requis), `target` `"_self"｜"_blank"｜"_parent"｜"_top"` |
| `LoadingButton` | comme `Button` + `isLoading` |
| `Modal` | `onClose`, `title` (string ou objet i18n), `icon`, `label` (a11y), `height` (string｜number), `width` `"small"｜"medium"｜"large"｜"x-large"｜"fullscreen"｜"resizable"` (Preview)｜string｜number, `shouldScrollInViewport` ; sous-composants `ModalHeader`, `ModalTitle` (`appearance`, `isMultiline`), `ModalBody`, `ModalFooter`, `ModalTransition` |
| `Form` | `onSubmit` (obligatoirement utilisé avec le hook **`useForm`** → `handleSubmit`, `register`, `getFieldId`) ; `FormHeader` (`title`, `description`), `FormSection`, `FormFooter` (`align`), `Label` (`labelFor`, `id`, `children`), `HelperMessage`, `ErrorMessage`, `ValidMessage`, `RequiredAsterisk` |
| `Select` | `options` (`(Option｜Group)[]`), `value`/`defaultValue`, `onChange(newValue)`, `isMulti`, `isSearchable`, `isClearable`, `isLoading`, `placeholder`, `isRequired`, `isInvalid`, `name` (requis **en macro config**), `spacing`, `appearance` |
| `TextArea` | `name`, `value`/`defaultValue`, `onChange`, `placeholder`, `isRequired`, `isInvalid`, `isDisabled`, `isReadOnly`, `minimumRows`, `maxLength`/`minLength`, `resize` `"none"｜"auto"｜"vertical"｜"horizontal"｜"smart"`, `isMonospaced` |
| `Checkbox` | `label`, `value`, `name`, `isChecked`/`defaultChecked`, `onChange(e)` (`e.target.checked`), `isRequired`, `isInvalid`, `isDisabled`, `isIndeterminate`, `id` |
| `Tabs` | `id` (requis, a11y), `children` (`TabList` puis n × `TabPanel`), `defaultSelected`, `selected`/`onChange` (mode contrôlé), `shouldUnmountTabPanelOnChange` ; `Tab` = `children: string` |
| `Spinner` | `label` (a11y, recommandé), `size` `"xsmall"｜"small"｜"medium"｜"large"｜"xlarge"｜number`, `appearance` `"inherit"｜"invert"`, `delay` |
| `Toggle` | `id`, `label` (aria-label si pas de label visible), `isChecked`/`defaultChecked`, `onChange`, `isDisabled`, `size` `"regular"｜"large"`, `name`, `value` |
| `Link` | `href` (requis, http(s):// ou relatif), `children` (requis), `openNewTab` (défaut `false`) |
| `Badge` | `children` (number｜string, requis), `appearance` (`neutral`, `danger`, `success`… + legacy), `max` (défaut 99, `false` = pas de plafond) |
| `EmptyState` | `header` (requis), `description`, `headingLevel`, `primaryAction`/`secondaryAction`/`tertiaryAction`, `isLoading`, `width` `"narrow"｜"wide"` |
| `Box` / `Stack` / `Inline` | `Box`: `padding*`, `backgroundColor`, `role`, `xcss` ; `Stack`: `space`, `alignBlock`, `alignInline`, `grow`, `spread` ; `Inline`: idem + `shouldWrap`, `separator`, `rowSpace` |
| `Heading` / `Text` | `Heading`: `size` (`xxsmall`…`xxlarge`), `as` (`h1`–`h6`), `children`, `color`, `id` ; `Text`: `children`, `size`, `weight`, `color`, `as`, `maxLines`, `align` |

### 1.3 Snippets TSX minimaux (copiables)

Tous importés depuis `@forge/react`. Racine obligatoire : `ForgeReconciler.render`.
```tsx
// src/frontend/index.tsx — squelette commun
import React from "react";
import ForgeReconciler, { Text } from "@forge/react";

const App = () => <Text>Hello</Text>;
ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
```

**SectionMessage** — https://developer.atlassian.com/platform/forge/ui-kit/components/section-message/ (*Jan 29, 2024*)

```tsx
import { SectionMessage, SectionMessageAction, Text } from "@forge/react";

<SectionMessage
  appearance="warning"                       // information | warning | error | success | discovery
  title={t("avis.title", "Release at risk")}
  actions={[
    <SectionMessageAction href="/browse/REL-42">Open issue</SectionMessageAction>,
    <SectionMessageAction onClick={() => setOpen(true)}>Details</SectionMessageAction>,
  ]}
>
  <Text>{t("avis.body", "3 blockers still open.")}</Text>
</SectionMessage>
```

**Lozenge** (gravité) — .../components/lozenge/ (*Oct 13, 2026*)

```tsx
import { Lozenge, Inline } from "@forge/react";

<Inline space="space.100">
  <Lozenge appearance="danger">Blocker</Lozenge>
  <Lozenge appearance="warning">At risk</Lozenge>
  <Lozenge appearance="neutral">Info</Lozenge>
  <Lozenge appearance="success">Clear</Lozenge>
</Inline>
```

**Tag** — .../components/tag/ (*Oct 19, 2026*)

```tsx
import { Tag, TagGroup } from "@forge/react";

<TagGroup>
  <Tag text="payments-api" color="blue" href="/browse/PAY-12" />
  <Tag text="billing" isRemovable removeButtonLabel="Remove" />
</TagGroup>
```

**DynamicTable** (liste = équivalent accessible du graphe) — .../components/dynamic-table/ (*Jul 23, 2025*)

```tsx
import { DynamicTable, Lozenge } from "@forge/react";

<DynamicTable
  label={t("graph.table.label", "Impact graph")}
  head={{ cells: [
    { key: "ticket", content: "Ticket", isSortable: true },
    { key: "service", content: "Service", isSortable: true },
    { key: "gravity", content: "Gravity", isSortable: true },
  ]}}
  rows={rows.map((r) => ({
    key: r.key,
    cells: [
      { key: r.key, content: r.ticket },
      { key: r.service, content: r.service },
      { key: r.gravity, content: <Lozenge appearance="danger">{r.gravity}</Lozenge> },
    ],
  }))}
  rowsPerPage={25}
  emptyView={t("graph.empty", "No signal")}
  paginationi18n={{ prev: t("p.prev","Previous"), next: t("p.next","Next"), label: t("p.page","Page") }}
/>
```

**Button / LinkButton / LoadingButton** — .../components/button/ (*Feb 26, 2025*)

```tsx
import { Button, LinkButton, LoadingButton } from "@forge/react";

<Button appearance="primary" onClick={() => recalc()}>{t("btn.recalc","Recompute")}</Button>
<Button appearance="subtle" onClick={close}>{t("btn.cancel","Cancel")}</Button>
<LinkButton href="/jira/software/projects/REL/apps/..." target="_blank">Settings</LinkButton>
<LoadingButton appearance="primary" isLoading={busy}>{t("btn.save","Save")}</LoadingButton>
```

**Modal** — .../components/modal/ (*Jun 19, 2026*)

```tsx
import { Modal, ModalTransition, ModalHeader, ModalTitle, ModalBody, ModalFooter, Button } from "@forge/react";

<ModalTransition>
  {isOpen && (
    <Modal onClose={() => setOpen(false)} width="medium" title={t("waiver.title","New waiver")}>
      <ModalHeader><ModalTitle>…</ModalTitle></ModalHeader>
      <ModalBody>{/* contenu */}</ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={() => setOpen(false)}>Cancel</Button>
        <Button appearance="primary" onClick={save}>Save</Button>
      </ModalFooter>
    </Modal>
  )}
</ModalTransition>
```

**Form + useForm + Select + TextArea + Checkbox + ErrorMessage** — .../components/form/ (*Jun 27, 2024*), .../select/ (*Jan 29, 2024*), .../text-area/ (*Feb 14, 2024*), .../checkbox/ (*Jan 29, 2024*)

```tsx
import {
  Form, FormHeader, FormSection, FormFooter, Label, HelperMessage, ErrorMessage,
  RequiredAsterisk, Select, TextArea, Checkbox, Button, useForm,
} from "@forge/react";

const { handleSubmit, register, getFieldId } = useForm();

<Form onSubmit={handleSubmit((data) => invoke("save-settings", data))}>
  <FormHeader title={t("set.title","Impact radius settings")} />
  <FormSection title={t("set.gravity","Gravity by signal")}>
    <Label labelFor={getFieldId("severity")}>Severity<RequiredAsterisk /></Label>
    <Select
      {...register("severity", { required: true })}
      options={[{ label: "Blocker", value: "blocker" }, { label: "Major", value: "major" }]}
      placeholder={t("set.severity.ph","Choose a level")}
    />
    <HelperMessage>{t("set.severity.help","Applies to every signal of this type.")}</HelperMessage>

    <Label labelFor={getFieldId("note")}>Note</Label>
    <TextArea {...register("note")} minimumRows={3} />

    <Checkbox {...register("waive")} label={t("set.waive","Allow waivers")} value="yes" />
    {error && <ErrorMessage>{error}</ErrorMessage>}
  </FormSection>
  <FormFooter><Button appearance="primary" type="submit">Save</Button></FormFooter>
</Form>
```

**Tabs** — .../components/tabs/ (*Jan 29, 2024*)

```tsx
import { Tabs, TabList, Tab, TabPanel } from "@forge/react";

<Tabs id="impact-tabs" defaultSelected={0}>
  <TabList>
    <Tab>{t("tab.graph","Graph")}</Tab>
    <Tab>{t("tab.teams","Teams")}</Tab>
    <Tab>{t("tab.waivers","Waivers")}</Tab>
    <Tab>{t("tab.history","History")}</Tab>
  </TabList>
  <TabPanel><GraphView /></TabPanel>
  <TabPanel><TeamsView /></TabPanel>
  <TabPanel><WaiversView /></TabPanel>
  <TabPanel><HistoryView /></TabPanel>
</Tabs>
```

**Spinner** — .../components/spinner/ (*Jan 29, 2024*)

```tsx
import { Spinner } from "@forge/react";
if (!data) return <Spinner size="medium" label={t("loading","Loading")} />;
```

**Toggle** — .../components/toggle/ (*Feb 14, 2024*)

```tsx
import { Toggle, Label } from "@forge/react";
<Toggle id="waivers" isChecked={on} onChange={(e) => setOn(!!e)} />
<Label labelFor="waivers">{t("set.waivers","Waivers enabled")}</Label>
```

---

## 2. Lire le contexte par module

Hook : **`useProductContext()`** (`@forge/react`) — https://developer.atlassian.com/platform/forge/ui-kit/hooks/use-product-context/ (*Sep 29, 2026*)

```ts
function useProductContext(): ProductContext | undefined;
// asynchrone : undefined pendant le chargement
interface ProductContext {
  accountId?: string; cloudId?: string; workspaceId?: string;
  extension: { [k: string]: any };
  installation?: { ari: { installationId: string }; contexts: ContextAri[] };
  license?: LicenseDetails;      // absent en dev/staging et pour apps gratuites
  localId: string; locale: string; moduleKey: string;
  siteUrl: string; timezone: string;
  theme?: { colorMode: string; light: string; dark: string; spacing: string };
}
```

Les champs métier sont dans **`context.extension`** (forme variable selon le module).

| Module | Champs `extension.*` | Source | Last updated |
|---|---|---|---|
| `jira:projectPage` | `type`, `project.id`, `project.key`, `project.type`, `board.id`, `board.type` (`"simple"｜"scrum"｜"kanban"`, Jira Software), `location` | [jira-project-page](https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-project-page/) | Sep 22, 2026 |
| `jira:issueContext` | `type`, `issue.id`, `issue.key`, `issue.type`, `issue.typeId`, `project.id`, `project.key`, `project.type`, `location` | [jira-issue-context](https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-issue-context/) | Oct 9, 2026 |
| `jira:projectSettingsPage` | `type`, `project.id`, `project.key`, `project.type`, `location` | [jira-project-settings-page](https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-project-settings-page/) | Sep 22, 2026 |
| `jira:dashboardGadget` | `gadgetConfiguration` (object), `dashboard.id`, `gadget.id`, `type`, `location` | [jira-dashboard-gadget](https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-dashboard-gadget/) | Aug 12, 2025 |
| `dashboards:widget` (successeur GA) | `type` (`dashboards:widget`), `entryPoint` (`"edit"`), `context.dashboardId`, `context.widgetId`, `placement`, `config`, `layout{width,height,columnSpan,rowSpan}`, `filters` | [dashboard-widget](https://developer.atlassian.com/platform/forge/manifest-reference/modules/dashboard-widget/) | Oct 29, 2026 |

**Version de release : aucun champ de contexte ne la porte.** Aucun `extension.version`, aucun `extension.issue.fixVersions`
dans la doc des quatre modules. → la version se lit soit dans les données de l'app (Forge SQL via `invoke`),
soit par un appel REST explicite (`requestJira('/rest/api/3/issue/{key}?fields=fixVersions')`) — **non documenté
comme champ de contexte**, c'est un choix d'implémentation.

```tsx
import { useProductContext } from "@forge/react";

const ctx = useProductContext();
if (!ctx) return <Spinner label="Loading" />;
const ext = ctx.extension as { project?: { id: string; key: string }; issue?: { id: string; key: string } };
const projectKey = ext.project?.key;
const issueKey = ext.issue?.key;
const locale = ctx.locale;          // ex. "fr-FR" / "en-US"
```

À noter : `jira:issueContext` peut aussi déclarer des **dynamicProperties** (statut badge/lozenge/icône affiché
quand le panneau est replié) — handler qui retourne `{ status: { type: "lozenge", value: { label, type } } }`,
payload = `{ cloudId, extension: { type, issue{id,type,key,typeId}, project{id,type,key} } }`.
Utile pour l'encart « une ligne » du ticket sans ouvrir le panneau.

---

## 3. Appeler le resolver et ouvrir des liens

### 3.1 `invoke` (le seul mécanisme documenté)

https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/invoke/ — *Jun 19, 2026*

```ts
function invoke(fnKey: string, payload?: Record<string | number, any>)
  : Promise<Record<string, any> | void>;
// variante avec metadata : { rateLimitProperties: true } → { body, metadata }
```

```tsx
import { invoke, makeInvoke } from "@forge/bridge";

const data = await invoke("get-impact", { projectKey, releaseId });

// TypeScript : types partagés front/back (sécurité de compilation, pas d'autorisation)
export type Defs = { getImpact: (p: { projectKey: string }) => Impact };
const invokeTyped = makeInvoke<Defs>();
```

- **`useAction` : non documenté.** La référence des hooks UI Kit ne liste que `useConfig`, `useContentProperty`,
  `useForm`, `useIssueProperty`, `useLocation`, `useNavigate`, `useObjectStore`, `useParams`, `useProductContext`,
  `useSpaceProperty`, `useTheme`, `useTranslation`, `useCurrentFilter` (EAP), `useFilters` (EAP),
  `useWidgetConfig`, `useWidgetContext` (hooks reference, *Sep 28, 2025*). → **pas de `useAction`, pas de `useForgeContext`**.
- Le backend se déclare avec `@forge/resolver` (`resolver.define('get-impact', async (req) => …)`), et
  `req.context` porte le même contexte que le front.

### 3.2 `requestJira` depuis le front

https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/requestJira/ — *May 27, 2026*

```ts
import { requestJira } from "@forge/bridge";
const res = await requestJira("/rest/api/3/issue/REL-42?fields=fixVersions");
```

⚠️ Toujours **au nom de l'utilisateur courant** : « There is no equivalent of `asApp()` on the `@forge/bridge`
package ». Si l'utilisateur n'a pas le droit Jira correspondant → **403 même avec les scopes corrects**.
Pour lire au nom de l'app (dossier d'impact, preuves filtrées), il faut `api.asApp().requestJira(...)`
depuis une fonction backend (`@forge/api`).

### 3.3 Ouvrir un lien / un ticket

`viewIssue` et `viewPageInNewTab` **n'existent pas** dans la référence actuelle (non documentés). Les équivalents :

| Besoin | API documentée | Source |
|---|---|---|
| Aller au ticket dans l'onglet courant | `router.navigate({ target: "issue", issueKey: "REL-42" })` | [router](https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/router/) — *Aug 21, 2026* |
| Ouvrir le ticket dans un nouvel onglet | `router.open({ target: "issue", issueKey: "REL-42" })` | idem |
| Construire l'URL | `await router.getUrl({ target: "issue", issueKey })` → `URL` | idem (Preview) |
| Aller à la page projet de l'app | `router.navigate({ target: "module", moduleKey, projectKey, path? })` | idem |
| Lien inline dans le texte | `<Link href="/browse/REL-42" openNewTab>` | [link](https://developer.atlassian.com/platform/forge/ui-kit/components/link/) — *Jan 29, 2024* |
| Bouton-lien | `<LinkButton href="…" target="_blank">` | [button](https://developer.atlassian.com/platform/forge/ui-kit/components/button/) — *Feb 26, 2025* |
| Modale d'aperçu du ticket | `new ViewIssueModal({ context: { issueKey }, onClose }).open()` (`@forge/jira-bridge`) | [ViewIssueModal](https://developer.atlassian.com/platform/forge/apis-reference/jira-api-bridge/viewIssueModal/) — *Dec 10, 2024* |

⚠️ `router.navigate`/`open` avec une **URL externe** : « the user is prompted before opening the link in a new tab »,
et la promesse est rejetée si l'utilisateur refuse. Les chemins relatifs (`/…`) ne déclenchent pas de prompt.
`NavigationLocation` est en **Preview** (Jira, Confluence, Bitbucket).

---

## 4. Gadget de tableau de bord : configuration et limites

Deux modules coexistent — c'est un piège de choix.

| | `jira:dashboardGadget` (legacy, celui de la spec) | `dashboards:widget` (GA, remplaçant) |
|---|---|---|
| Source | [jira-dashboard-gadget](https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-dashboard-gadget/) (*Aug 12, 2025*) | [dashboard-widget](https://developer.atlassian.com/platform/forge/manifest-reference/modules/dashboard-widget/) (*Oct 29, 2026*) |
| Vue / édition | `resource` + `render: native` ; `edit.resource` + `edit.render: native` | idem (`edit` **obligatoire** aujourd'hui) |
| Config côté code | `view.submit({ ...champs, refresh: 15 })` dans la vue d'édition ; reçue dans `extension.gadgetConfiguration` | hook **`useWidgetConfig()`** → `{ config, updateConfig }` |
| Auto-refresh | champ `refresh` (entier positif, minutes) au submit ; `refreshable: false` pour reprendre la main + événement `JIRA_DASHBOARD_GADGET_REFRESH` (`events.on`) | non documenté dans la page widget |
| Contexte | `extension.gadgetConfiguration`, `extension.dashboard.id`, `extension.gadget.id` | `useWidgetContext()` → `layout{width,height,columnSpan,rowSpan}`, `widgetId`, `dashboardId`, `filters` |
| i18n | `title`/`description` acceptent un objet `{ i18n: "clé" }` | `title`/`description` (string) |
| Hauteur / iframe | **non documenté** : aucune propriété de hauteur, pas d'iframe (UI Kit rend nativement) ; la page ne décrit que `thumbnail`, `refreshable`, `displayConditions`, `connectKeys` | `layout.height`/`layout.width` en **px** fournis par la plateforme (lecture seule) |
| Migration | `connectKeys: string[]` pour remplacer des gadgets Connect | — |

- Le module legacy est **toujours documenté et utilisable** (« This module can be used in Jira and Jira Service
  Management »), mais les hooks `useWidgetConfig`/`useWidgetContext` sont explicitement rattachés au nouveau module.
- Limites du nouveau module : `edit` requis ; `aiContext.data` (EAP) limité à **1 000 lignes** et
  **300 000 caractères** sérialisés. Ces limites concernent l'AI context, pas l'affichage.
- **Aucune limite de hauteur/scroll documentée** pour `jira:dashboardGadget` → « non documenté ». En pratique la
  spec doit donc prévoir un contenu compact pour les « versions des 14 prochains jours ».

---

## 5. i18n : méthode recommandée

### 5.1 Ce qui est documenté

- Guide : https://developer.atlassian.com/platform/forge/internationalization/ — *Jul 24, 2026*
- Manifest : https://developer.atlassian.com/platform/forge/manifest-reference/translations/ — *(pas de « Last updated » affichée sur la page servie le 2026-11-11)*
- Codes de langue : https://developer.atlassian.com/platform/forge/manifest-reference/forge-supported-locale-codes/ — *(pas de date affichée)* ; **`en-US`** et **`fr-FR`** sont supportés (BCP-47).
- Front UI Kit : `useTranslation` + `I18nProvider` (`@forge/react`) — https://developer.atlassian.com/platform/forge/ui-kit/hooks/use-translation/ — *(pas de date affichée)*
- Back (fonctions) : `i18n.createTranslationFunction(locale)` / `i18n.getTranslations(locale)` (`@forge/api`) — https://developer.atlassian.com/platform/forge/runtime-reference/i18n/ — *Jul 4, 2025*
- Custom UI (pas notre cas) : `i18n` de `@forge/bridge`.

Les quatre modules de la spec (**Project page, Issue context, Project settings page, Dashboard gadget**) figurent
tous dans la liste « Supported modules » du guide i18n.

### 5.2 Recette

`manifest.yml` :

```yaml
modules:
  jira:projectPage:
    - key: impact-project-page
      resource: main
      render: native
      resolver: { function: resolver }
      title: { i18n: "page.title" }      # titre traduit dans la navigation Jira

translations:
  resources:
    - key: en-US
      path: locales/en-US.json
    - key: fr-FR
      path: locales/fr-FR.json
  fallback:
    default: en-US                      # OBLIGATOIRE, doit contenir toutes les clés du manifest
```

`locales/fr-FR.json` (clés imbriquées **ou** aplaties ; l'aplatie gagne) :

```json
{ "page": { "title": "Rayon d'impact" }, "avis": { "title": "Version à risque" } }
```

Front :

```tsx
import ForgeReconciler, { I18nProvider, useTranslation } from "@forge/react";

const App = () => {
  const { ready, t, locale } = useTranslation();
  if (!ready) return null;
  return <Text>{t("avis.title", "Release at risk")}</Text>;
};

ForgeReconciler.render(
  <React.StrictMode>
    <I18nProvider>   {/* sans prop locale = locale de l'utilisateur via view.getContext() */}
      <App />
    </I18nProvider>
  </React.StrictMode>
);
```

- **Détection de langue** : automatique. `I18nProvider` sans `locale` prend « the user's preferred locale,
  which is retrieved from `view.getContext()` » ; la même valeur est exposée par `useProductContext().locale`
  et par `context.locale` côté backend. On peut forcer : `<I18nProvider locale="fr-FR">`.
- `t(key, defaultValue)` : renvoie `defaultValue` si la clé manque, sinon la **clé elle-même** (pratique pour repérer les trous).
- **Limite de taille** : les fichiers de traduction référencés dans le manifest ont un total de **100 KB** ;
  les traductions appelées depuis le code front (via `useTranslation`) n'ont pas de limite (bundlées).
- Back : `const t = await i18n.createTranslationFunction(locale)` ; pour i18next/pluriels :
  `await i18n.getTranslations(locale, { fallback: true })`.
- Contraintes : **UI Kit 1 (legacy) non supporté** ; CLI ≥ 11.3.0 ; `@forge/bridge`/`@forge/react` à jour.

### 5.3 `@forge/i18n` existe-t-il ?

- Le paquet **existe sur npm** : `@forge/i18n`, description « Common utilities and typings for Forge i18n support »,
  publié par Atlassian (`atlassianartifactteam`), `latest` = **1.0.1** (publié le 2026-10-26), créé le 2024-09-06.
- **Mais il n'est documenté nulle part** sur developer.atlassian.com : ni dans le guide i18n, ni dans la référence
  runtime/bridge/hooks. Les seules API publiques documentées sont `useTranslation`/`I18nProvider` (front UI Kit),
  `i18n` de `@forge/bridge` (Custom UI) et `i18n` de `@forge/api` (fonctions).
- **Conclusion** : ne pas s'appuyer sur `@forge/i18n` (paquet interne de typings, non contractuel) → utiliser
  `useTranslation` + `translations.resources`. Si un besoin n'est pas couvert (pluriels riches côté front),
  **non documenté** : dictionnaire maison (objet `{ fr: {...}, en: {...} }` indexé par `locale`) en complément.

---

## 6. Pièges à retenir

1. **Noms** : `StatusLozenge`→`Lozenge`, `ModalDialog`→`Modal`, `Table`→`DynamicTable`, `Textarea`→`TextArea`.
   `ErrorMessage` vit dans la page **Form**.
2. **Pas de DOM** : aucun `<div>`/`<a href>`, pas de portail, pas de `useRef` sur un nœud → tout passe par
   `Box`/`Stack`/`Inline`/`Link`/`xcss`.
3. **Pas de `useAction` ni `useForgeContext`** : `invoke()` de `@forge/bridge` + `@forge/resolver` côté back.
4. **Pas de `viewIssue`/`viewPageInNewTab`** : `router.navigate`/`router.open`/`router.getUrl` (Preview) ou
   `Link`/`LinkButton`/`ViewIssueModal`.
5. **`requestJira` front = droits de l'utilisateur** (403 sinon) ; pour lire en tant qu'app → backend `asApp()`.
6. **Aucune « version » dans le contexte** d'aucun des 4 modules → la version vient des données de l'app ou d'un REST explicite.
7. **Gadget** : deux modules concurrents ; `jira:dashboardGadget` = `edit.resource` + `view.submit({ refresh })`,
   `refreshable: false` + événement `JIRA_DASHBOARD_GADGET_REFRESH` pour l'auto-refresh maison ;
   **hauteur non documentée** (le nouveau `dashboards:widget` expose `layout.height` en px).
8. **i18n** : le `fallback.default` doit contenir **toutes** les clés du manifest, sinon `forge deploy` échoue ;
   total des fichiers de traduction ≤ 100 KB ; `@forge/i18n` non documenté.
