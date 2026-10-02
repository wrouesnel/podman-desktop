<script lang="ts">
import { faDownload, faPen, faTrash } from '@fortawesome/free-solid-svg-icons';
import { getContext } from 'svelte';

import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';

import { PVC_FILE_BROWSER_CONTEXT, type PvcFileBrowserContext, type PvcFileRow } from './pvc-file-browser';

interface Props {
  object: PvcFileRow;
}
let { object }: Props = $props();

const browser = getContext<PvcFileBrowserContext>(PVC_FILE_BROWSER_CONTEXT);
</script>

<ListItemButtonIcon title="Download {object.name}" icon={faDownload} onClick={(): void => browser.download([object])} />
<ListItemButtonIcon
  title="Rename {object.name}"
  icon={faPen}
  enabled={!browser.readOnly}
  onClick={(): void => browser.startRename(object)} />
<ListItemButtonIcon
  title="Delete {object.name}"
  icon={faTrash}
  enabled={!browser.readOnly}
  onClick={(): void => browser.delete([object])} />
