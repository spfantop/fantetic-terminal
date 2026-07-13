<template>
  <nav class="admin-pagination" :aria-label="label">
    <span>{{ summary }}</span>
    <div>
      <button type="button" :disabled="page <= 1 || disabled" :aria-label="t('common.previous', '上一页')" @click="emit('update:page', page - 1)"><i class="fas fa-chevron-left" aria-hidden="true"></i></button>
      <span class="page-indicator" aria-current="page">{{ page }} / {{ safePageCount }}</span>
      <button type="button" :disabled="page >= safePageCount || disabled" :aria-label="t('common.next', '下一页')" @click="emit('update:page', page + 1)"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>
    </div>
  </nav>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
const props=withDefaults(defineProps<{page:number;pageCount:number;total:number;disabled?:boolean;label?:string}>(),{disabled:false,label:undefined});
const emit=defineEmits<{ 'update:page':[page:number] }>(); const {t}=useI18n();
const safePageCount=computed(()=>Math.max(1,props.pageCount));
const summary=computed(()=>t('adminCenter.paginationSummary',{total:props.total},`${props.total} 条记录`));
const label=computed(()=>props.label||t('adminCenter.pagination','分页导航'));
</script>
<style scoped>
.admin-pagination{display:flex;justify-content:space-between;align-items:center;gap:.8rem;padding:.75rem 1rem;color:var(--muted-foreground);font-size:.8rem}.admin-pagination>div{display:flex;align-items:center;gap:.4rem}.admin-pagination button{display:grid;place-content:center;width:2rem;height:2rem;padding:0;border:1px solid var(--border);border-radius:.4rem;background:var(--background);color:var(--foreground);cursor:pointer}.admin-pagination button:hover:not(:disabled),.admin-pagination button:focus-visible{border-color:var(--primary);color:var(--primary);outline:2px solid color-mix(in srgb,var(--primary) 30%,transparent);outline-offset:2px}.admin-pagination button:disabled{opacity:.45;cursor:not-allowed}.page-indicator{min-width:4.5rem;text-align:center;font-variant-numeric:tabular-nums}@media(max-width:520px){.admin-pagination>span{display:none}.admin-pagination{justify-content:center}}
</style>
