<script lang="ts">
import KubeResourceActions from '/@/lib/kube-resources/KubeResourceActions.svelte';

import type { Props } from './props';

let { object }: Props = $props();
</script>

<KubeResourceActions resource={object} />
