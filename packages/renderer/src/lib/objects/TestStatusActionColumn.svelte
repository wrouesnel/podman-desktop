<script lang="ts">
import type { KubernetesObjectUI } from './KubernetesObjectUI';

// test column rendering the status of the object, with an action changing the status (as the delete actions do)
interface Props {
  object: KubernetesObjectUI;
}

let { object }: Props = $props();
</script>

<span>status:{object.status}</span>
<button onclick={(): string => (object.status = 'DELETING')}>delete {object.name}</button>
