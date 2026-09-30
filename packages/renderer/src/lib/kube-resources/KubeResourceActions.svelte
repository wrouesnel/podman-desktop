<script lang="ts">
import { faTrash } from '@fortawesome/free-solid-svg-icons';

import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';

import { deleteKubeResource } from './kube-resource-utils';
import type { KubeResourceUI } from './KubeResourceUI';

interface Props {
  resource: KubeResourceUI;
  detailed?: boolean;
}
let { resource, detailed = false }: Props = $props();

async function deleteResource(): Promise<void> {
  resource.status = 'DELETING';
  await deleteKubeResource(resource);
}
</script>

<ListItemButtonIcon
  title="Delete {resource.kind}"
  onClick={(): void =>
    withConfirmation(deleteResource, `delete ${resource.kind} ${resource.name}`, {
      title: `Delete ${resource.kind}?`,
      variant: 'delete',
    })}
  detailed={detailed}
  icon={faTrash} />
