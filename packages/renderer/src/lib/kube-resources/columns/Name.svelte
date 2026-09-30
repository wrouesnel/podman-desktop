<script lang="ts">
import { router } from 'tinro';

import { getResourceDetailsURL } from '/@/lib/kube-resources/kube-resource-descriptor';

import type { Props } from './props';

let { object }: Props = $props();

function openDetails(): void {
  router.goto(getResourceDetailsURL(object.resource, object.name, object.namespace));
}
</script>

<button class="hover:cursor-pointer flex flex-col max-w-full text-left" onclick={openDetails}>
  <div class="text-[var(--pd-table-body-text-highlight)] overflow-hidden text-ellipsis">
    {object.name}
  </div>
  {#if object.namespace}
    <div class="text-[var(--pd-table-body-text)] font-extra-light text-sm overflow-hidden text-ellipsis">
      {object.namespace}
    </div>
  {/if}
</button>
