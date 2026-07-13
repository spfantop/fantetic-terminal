<template>
  <fieldset ref="root" class="admin-date-range">
    <legend>{{ label }}</legend>
    <div class="date-fields">
      <label><span>{{ t('adminDateRange.start') }}</span><button type="button" class="date-input" @click="openCalendar('start')"><i class="fas fa-calendar-day"></i><span>{{ start || t('adminDateRange.selectDate') }}</span></button></label>
      <span class="separator">—</span>
      <label><span>{{ t('adminDateRange.end') }}</span><button type="button" class="date-input" @click="openCalendar('end')"><i class="fas fa-calendar-check"></i><span>{{ end || t('adminDateRange.selectDate') }}</span></button></label>
    </div>
    <div v-if="calendarTarget" class="calendar-popover" role="dialog" :aria-label="t('adminDateRange.calendar')">
      <header><button type="button" :aria-label="t('adminDateRange.previousMonth')" @click="moveMonth(-1)"><i class="fas fa-chevron-left"></i></button><strong>{{ monthTitle }}</strong><button type="button" :aria-label="t('adminDateRange.nextMonth')" @click="moveMonth(1)"><i class="fas fa-chevron-right"></i></button></header>
      <div class="calendar-weekdays"><span v-for="name in weekdayNames" :key="name">{{ name }}</span></div>
      <div class="calendar-days"><button v-for="day in calendarDays" :key="day.key" type="button" :class="{ muted: !day.currentMonth, selected: day.value === selectedValue, today: day.value === todayValue }" @click="chooseDate(day.value)">{{ day.label }}</button></div>
      <footer><button type="button" @click="calendarTarget = null">{{ t('common.close') }}</button></footer>
    </div>
  </fieldset>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
const props = defineProps<{ label: string; start: string; end: string }>();
const emit = defineEmits<{ 'update:start': [value: string]; 'update:end': [value: string] }>();
const { t } = useI18n();
const calendarTarget = ref<'start' | 'end' | null>(null);
const root = ref<HTMLElement>();
const visibleMonth = ref(new Date());
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const todayValue = localDate(new Date());
const selectedValue = computed(() => calendarTarget.value === 'start' ? props.start : props.end);
const weekdayNames = computed(() => Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(new Date(2024, 0, 7 + index))));
const monthTitle = computed(() => new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' }).format(visibleMonth.value));
const calendarDays = computed(() => { const year=visibleMonth.value.getFullYear(); const month=visibleMonth.value.getMonth(); const first=new Date(year,month,1); const start=new Date(year,month,1-first.getDay()); return Array.from({length:42},(_,index)=>{const date=new Date(start);date.setDate(start.getDate()+index);return {key:date.toISOString(),value:localDate(date),label:date.getDate(),currentMonth:date.getMonth()===month};}); });
const openCalendar = (target: 'start' | 'end') => { calendarTarget.value=target; const value=target==='start'?props.start:props.end; visibleMonth.value=value?new Date(`${value}T12:00:00`):new Date(); };
const moveMonth = (offset: number) => { visibleMonth.value=new Date(visibleMonth.value.getFullYear(),visibleMonth.value.getMonth()+offset,1); };
const chooseDate = (value: string) => { if(calendarTarget.value==='start')emit('update:start',value);else emit('update:end',value);calendarTarget.value=null; };
const closeFromDocument = (event: PointerEvent) => { if(calendarTarget.value&&!root.value?.contains(event.target as Node))calendarTarget.value=null; };
const closeFromKeyboard = (event: KeyboardEvent) => { if(event.key==='Escape')calendarTarget.value=null; };
onMounted(() => { document.addEventListener('pointerdown',closeFromDocument);document.addEventListener('keydown',closeFromKeyboard); });
onBeforeUnmount(() => { document.removeEventListener('pointerdown',closeFromDocument);document.removeEventListener('keydown',closeFromKeyboard); });
</script>
<style scoped>
.admin-date-range{position:relative;display:grid;container-type:inline-size;width:100%;min-width:0;gap:.35rem;margin:0;padding:0;border:0}.admin-date-range legend,.date-fields label>span:first-child{color:var(--muted-foreground);font-size:var(--admin-font-xs);font-weight:600}.date-fields{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:end;gap:.35rem}.date-fields label{display:grid;min-width:0;gap:.2rem}.separator{padding-bottom:.6rem;color:var(--muted-foreground)}.date-input{display:flex;width:100%;min-width:0;align-items:center;gap:.5rem;padding:.55rem .65rem;border:1px solid var(--border);border-radius:.45rem;background:var(--background);color:var(--foreground);white-space:nowrap}.date-input span{min-width:0;overflow:hidden;text-overflow:ellipsis}.date-input i{flex:none;color:var(--muted-foreground)}.calendar-popover{position:absolute;top:calc(100% + .35rem);left:0;z-index:40;width:min(19rem,100%);min-width:min(16rem,calc(100vw - 3rem));padding:.75rem;border:1px solid var(--border);border-radius:.65rem;background:var(--card);box-shadow:0 14px 35px rgba(0,0,0,.28)}.calendar-popover header,.calendar-popover footer{display:flex;align-items:center;justify-content:space-between}.calendar-popover button{border:0;background:transparent;color:var(--foreground);cursor:pointer}.calendar-weekdays,.calendar-days{display:grid;grid-template-columns:repeat(7,1fr);gap:.15rem}.calendar-weekdays{margin:.65rem 0 .3rem;text-align:center;color:var(--muted-foreground);font-size:var(--admin-font-xs)}.calendar-days button{aspect-ratio:1;border-radius:.35rem}.calendar-days button:hover{background:var(--accent)}.calendar-days .muted{opacity:.45}.calendar-days .today{box-shadow:inset 0 0 0 1px var(--primary)}.calendar-days .selected{background:var(--primary);color:var(--primary-foreground)}.calendar-popover footer{justify-content:flex-end;margin-top:.4rem}@container(max-width:16rem){.date-fields{grid-template-columns:1fr}.separator{display:none}.calendar-popover{width:100%}}@media(max-width:640px){.calendar-popover{width:min(19rem,calc(100vw - 3rem))}}
.admin-date-range legend{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
</style>
