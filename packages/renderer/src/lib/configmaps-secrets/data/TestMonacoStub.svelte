<script lang="ts">
import { createEventDispatcher } from 'svelte';

// replaces MonacoEditor in the tests: a textarea
interface Props {
  content?: string;
  language?: string;
  readOnly?: boolean;
}
let { content = '', language = '', readOnly = true }: Props = $props();

const dispatch = createEventDispatcher<{ contentChange: string }>();
</script>

<textarea
  aria-label="Text editor"
  data-language={language}
  readonly={readOnly}
  value={content}
  oninput={(event): boolean => dispatch('contentChange', (event.target as HTMLTextAreaElement).value)}></textarea>
