<script lang="ts">
import { renderCounter } from './test-render-counter';

interface Props {
  object: { name: string; value: string };
}

let { object }: Props = $props();

$effect.pre(() => {
  if (object) {
    renderCounter.count++;
  }
});
</script>

<span>{object.value}</span>
