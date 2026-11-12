/**
 * Façade UI Kit 2 (`@forge/react`).
 *
 * En UI Kit 2, l'écran ne décrit que des **composants de la plateforme** : un
 * élément HTML brut (`<div>`, `<p>`, `<span>`) est rejeté par le moteur de rendu
 * d'Atlassian (« Error rendering app - encountered unknown component »), car le
 * document rendu est une liste de composants que la plateforme sait dessiner —
 * `Box`, `Text`, `Heading`, `Button`… — et non du HTML.
 *
 * Les écrans importent donc tout depuis cette façade, jamais depuis
 * `@atlaskit/*` (UI Kit 1) ni en HTML brut. Les primitives sont ré-exportées
 * telles quelles : `@forge/react` expose déjà des constantes de nom ("Box",
 * "Text"…), que le moteur de rendu d'Atlassian résout.
 *
 * Le même motif que `laddition/src/ui/kit.tsx` sur ce site de démonstration.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import { Fragment as ReactFragment } from 'react';

export {
  Badge,
  Box,
  Button,
  Checkbox,
  Code,
  DynamicTable,
  Em,
  EmptyState,
  Form,
  FormFooter,
  FormHeader,
  FormSection,
  Frame,
  Heading,
  HelperMessage,
  I18nProvider,
  Icon,
  Image,
  Inline,
  Label,
  Link,
  List,
  ListItem,
  Lozenge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ProgressBar,
  RadioGroup,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Strong,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tag,
  Text,
  TextArea,
  Textfield,
  Toggle,
  Tooltip,
} from '@forge/react';

export { useProductContext, useTranslation } from '@forge/react';

/** Fragment : l'équivalent de `<>…</>` dans un arbre de composants plateforme. */
export const Fragment = ReactFragment;
