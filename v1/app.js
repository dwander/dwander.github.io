const STORAGE_KEY_STATE = 'checklist:state';
const STORAGE_KEY_PRESETS = 'checklist:presets';
const STORAGE_KEY_THEME = 'checklist:theme';

const { createApp } = Vue;

const app = createApp({
    data(){ 
        return { _toastEl: null, _toastTimer: null, toastVisible: false, toastMessage: '', toastTimer: null, _saveTimer: null, _saveQueued: false, _rafMap: new Map(), actionsAnimating: false,
            actionsAnimUntil: 0,
            pointerTimers: {},
            pointerActive: {},
            appTitle: '원판 체크리스트',
            editingTitle: false,
            tempTitle: '',
            showModal: false,
            showTrashModal: false,
            showDescriptionModal: false,
            showPresetModal: false,
            showMenu: false,
            modalMode: 'add',
            modalData: { text: '', description: '' },
            editingItem: null,
            selectedItem: null,
            showNumbers: false,
            isDarkMode: false,
            uiLocked: false,
            trashItems: [],
            presets: {},
            selectedPresetSlot: null,
            sortableInstance: null,
            activeActions: null,
            actionsTimeout: null,
            actionsKeepAlive: false,
            items: [
                { id: 1, text: '신랑신부 포즈컷', description: '', completed: false },
                { id: 2, text: '신부 포즈컷', description: '', completed: false },
                { id: 3, text: '신랑신부 정면', description: '', completed: false },
                { id: 4, text: '양가 혼주', description: '', completed: false },
                { id: 5, text: '가족 친척 전체', description: '', completed: false },
                { id: 6, text: '신랑측 직계가족', description: '', completed: false },
                { id: 7, text: '신부측 직계가족', description: '', completed: false },
                { id: 8, text: '직장동료 우인', description: '', completed: false },
                { id: 9, text: '부케 던지기', description: '', completed: false },
                { id: 10, text: '플래시 컷', description: '', completed: false },
                { id: 11, text: '주례', description: '', completed: false }
            ],
            nextId: 12,
            pointers: {},
            isPointerPressed: false,
            pointerStartTime: 0
        }
    },
    
    computed: {
        modalTitle() {
            return this.modalMode === 'add' ? '새 촬영 항목 추가' : '항목 수정';
        }
    },
    
    watch: {
        items: {
            handler() {
                this.saveToStorage();
            },
            deep: true
        },
        trashItems: {
            handler() {
                this.saveToStorage();
            },
            deep: true
        },
        isDarkMode() {
            this.saveToStorage();
            this.applyTheme();
        },
        appTitle() {
            this.saveToStorage();
        }
    },
    
    mounted() {
        this.isPointerFine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
        this.loadFromStorage();
        this.loadPresets();
        this.initializeTheme();
        this.initSortable();
        document.addEventListener('click', this.handleOutsideClick);
    },
    
    methods: {
        // 한국어 조사 자동 선택: pair 예) '이가', '을를', '은는', '과와'
        josa(value, pair = '이가') {
            try {
                const s = String(value).trim();
                const last = s.charAt(s.length - 1);
                const code = last.charCodeAt(0);
                const pick = (withJong) => withJong ? pair[0] : pair[1];
                // 한글 음절 범위
                if (code >= 0xAC00 && code <= 0xD7A3) {
                    const jong = (code - 0xAC00) % 28; // 0이면 받침 없음
                    return pick(jong != 0);
                }
                // 숫자(마지막 자리 발음의 받침 여부 기반)
                if (/\d/.test(last)) {
                    const d = parseInt(last, 10);
                    const hasJong = [0,1,3,6,7,8].includes(d); // 영,일,삼,육,칠,팔 → 받침 O
                    return pick(hasJong);
                }
                // 기타 문자: 기본적으로 받침 없음 취급
                return pick(false);
            } catch(_) { return pair[1]; }
        },
        showToast(message = '완료되었습니다.', duration = 2000) {
            try { if (this.toastTimer) clearTimeout(this.toastTimer); } catch(_) {}
            this.toastMessage = message;
            this.toastVisible = true;
            this.toastTimer = setTimeout(() => { this.toastVisible = false; }, duration);
        },
        clearAllTimers(id = null) {
            if (id) {
                if (this.pointerTimers[id]) {
                    clearTimeout(this.pointerTimers[id]);
                    delete this.pointerTimers[id];
                }
            }
            if (this.actionsTimeout) {
                clearTimeout(this.actionsTimeout);
                this.actionsTimeout = null;
            }
        },

        getCardElById(id){
            try {
                // Faster direct lookup via attribute selector (no full list scan)
                const el = this.$el.querySelector(`.list-item[data-id="${id}"] .item-card`);
                return el || null;
            } catch(_) {
                return null;
            }
        },

        // --- 완전 통합된 액션 시스템 ---
        showActions(itemId, autoHideDuration = null) {
            if (this.uiLocked) return;
            
            this.clearAllTimers();
            this.activeActions = itemId;
            
            // 디바이스별 기본 지속시간 (단순화)
            const duration = autoHideDuration || (this.isPointerFine ? 6000 : 3000);
            
            // 애니메이션 가드 (필요시에만)
            if (!this.isPointerFine) {
                this.actionsAnimating = true;
                this.actionsAnimUntil = performance.now() + 260;
                setTimeout(() => { this.actionsAnimating = false; }, 260);
            }
            
            this.scheduleHideActions(duration);
        },

        hideActions() {
            this.clearAllTimers();
            this.activeActions = null;
            this.actionsKeepAlive = false;
        },

        scheduleHideActions(ms) {
            this.clearAllTimers();
            if (this.actionsKeepAlive) return;
            
            this.actionsTimeout = setTimeout(() => {
                if (!this.actionsKeepAlive) {
                    this.activeActions = null;
                }
            }, ms);
        },

        keepActionsAlive() {
            this.actionsKeepAlive = true;
            this.clearAllTimers();
        },

        releaseActionsKeepAlive() {
            this.actionsKeepAlive = false;
            this.scheduleHideActions(1500); // 통합된 지연시간
        },

        guardAction(fn) {
            if (!this.isPointerFine && this.actionsAnimating) {
                return;
            }
            try { fn && fn(); } catch(e) {}
        },

        onCardPointerEnter(e, itemId) {
            if (this.uiLocked) return;
            // 모든 포인터 타입에서 호버 동작 (데스크탑/터치 구분 없음)
            if (e.pointerType === 'mouse' && this.isPointerFine) {
                this.showActions(itemId, 6000);
            }
        },

        onCardPointerLeave(e, itemId) {
            if (this.uiLocked) return;
            if (e.pointerType === 'mouse' && this.isPointerFine) {
                this.clearAllTimers();
                this.actionsTimeout = setTimeout(() => {
                    if (this.activeActions === itemId && !this.actionsKeepAlive) {
                        this.hideActions();
                    }
                }, 300);
            }
        },

        onItemPointerDown(e, id) {
            // 포인터 캡처
            try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch(_) {}
            
            this.pointerActive[id] = true;
            this.isPointerPressed = true;
            this.pointerStartTime = performance.now();
            
            // 좌표 저장 (모든 포인터 타입 통합)
            const clientX = e.clientX;
            const clientY = e.clientY;
            
            if (clientX !== undefined && clientY !== undefined) {
                this.pointers[id] = { sx: clientX, sy: clientY, toggled: false };
            }

            const el = this.getCardElById(id);
            if (el) {
                el.classList.add('drag-arming');
            }
            
            // 통합된 롱프레스 감지 (모든 디바이스)
            if (this.pointerTimers[id]) clearTimeout(this.pointerTimers[id]);
            this.pointerTimers[id] = setTimeout(() => {
                if (this.pointerActive[id]) {
                    // 롱프레스시 항상 액션 표시 (디바이스 구분 없음)
                    this.showActions(id);
                    if (navigator && navigator.vibrate) { navigator.vibrate(12); }
                }
            }, 500); // 약간 더 긴 지연시간으로 통합
        },
        
        onItemPointerMove(e, item) {
            if (this.uiLocked) return;
            
            const id = item && item.id;
            const state = this.pointers[id] || {};
            
            if (!this.pointerActive[id] || !state.sx) return;
            
            const clientX = e.clientX;
            const clientY = e.clientY;
            
            if (clientX === undefined || clientY === undefined) return;
            
            const dx = clientX - (state.sx || 0);
            const dy = clientY - (state.sy || 0);
            const el = this.getCardElById(id);

            // 드래그 감지시 롱프레스 취소 (통합)
            if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
                if (this.pointerTimers[id]) clearTimeout(this.pointerTimers[id]);
            }

            // 수평 스와이프 감지 (모든 디바이스 동일)
            const hori = Math.abs(dx) >= 12 && Math.abs(dx) > Math.abs(dy) * 1.5;
            if (el) {
                const tx = Math.max(-72, Math.min(dx, 72));
                // Batch DOM writes for smoother pointer moves

                const _id = id;

                if (!this._rafMap.has(_id)) {

                    this._rafMap.set(_id, requestAnimationFrame(() => {

                        try {

                            const _el = this.getCardElById(_id);

                            if (_el) _el.style.transform = `translateX(${tx}px)`;

                        } finally {

                            this._rafMap.delete(_id);

                        }

                    }));

                }
            }

            // 체크 토글 (통합된 로직)
            if (hori && dx > 42 && !state.toggled && !item.completed) {
                this.toggleComplete(item);
                state.toggled = true;
                this.pointers[id] = state;
                try { if (navigator && navigator.vibrate) navigator.vibrate(12); } catch(_) {}
            }

            if (hori && dx < -42 && !state.toggled && item.completed) {
                this.toggleComplete(item);
                state.toggled = true;
                this.pointers[id] = state;
                try { if (navigator && navigator.vibrate) navigator.vibrate(12); } catch(_) {}
            }
        },

        onItemPointerUp(e, id) {
            // cancel any pending rAF updates for this id
            try {
                const handle = this._rafMap && this._rafMap.get(id);
                if (handle) {
                    cancelAnimationFrame(handle);
                    this._rafMap.delete(id);
                }
            } catch(_) {}

            this.pointerActive[id] = false;
            this.isPointerPressed = false;

            try { 
                e.target.releasePointerCapture && e.target.releasePointerCapture(e.pointerId);
            } catch(_) {}            

            // 정리 작업 (통합)
            try {
                const el = this.getCardElById(id);
                if (el) {
                    el.style.transform = '';
                }
                if (this.pointers[id]) delete this.pointers[id];
            } catch(_) {}

            this.clearAllTimers(id);
            const el = this.getCardElById(id);
            if (el && !el.classList.contains('dragging')) {
                el.classList.remove('drag-arming');
            }
        },

        // --- 액션 패널 이벤트 (단순화됨) ---
        onActionsEnter() {
            this.keepActionsAlive();
        },

        onActionsLeave() {
            this.releaseActionsKeepAlive();
        },

        // --- 기존 메서드들 (변경 없음) ---
        showAddInput() {
            if (this.uiLocked) return;
            this.modalMode = 'add';
            this.modalData = { text: '', description: '' };
            this.editingItem = null;
            this.showModal = true;
            this.$nextTick(() => {
                if (this.$refs.modalTitleInput) {
                    this.$refs.modalTitleInput.focus();
                }
            });
        },

        startEdit(item) {
            if (this.uiLocked) return;
            this.modalMode = 'edit';
            this.modalData = { 
                text: item.text, 
                description: item.description || '' 
            };
            this.editingItem = item;
            this.showModal = true;
            this.$nextTick(() => {
                if (this.$refs.modalTitleInput) {
                    this.$refs.modalTitleInput.focus();
                    this.$refs.modalTitleInput.select();
                }
            });
        },

        cancelModal() {
            this.showModal = false;
            this.modalData = { text: '', description: '' };
            this.editingItem = null;
        },

        saveModal() {
            if (!this.modalData.text.trim()) return;
            
            if (this.modalMode === 'add') {
                this.items.push({
                    id: this.nextId++,
                    text: this.modalData.text.trim(),
                    description: this.modalData.description.trim(),
                    completed: false
                });
            } else if (this.editingItem) {
                this.editingItem.text = this.modalData.text.trim();
                this.editingItem.description = this.modalData.description.trim();
            }
            
            this.cancelModal();
        },

        clickTitle(item, e) {
            return;
        },
        
        toggleComplete(item) {
            item.completed = !item.completed;
            try { this.saveToStorage && this.saveToStorage(); } catch (e) {}
        },

        toggleTheme() {
            this.isDarkMode = !this.isDarkMode;
            this._themeAutoFollow = false;
            try { localStorage.setItem(STORAGE_KEY_THEME, this.isDarkMode ? 'dark' : 'light') } catch(_) {}
            this.applyTheme();
            this.showMenu = false;
        },

        applyTheme() {
            if (this.isDarkMode) {
                document.documentElement.setAttribute('data-theme', 'dark');
            } else {
                document.documentElement.removeAttribute('data-theme');
            }
        },
        
        initializeTheme() {
            const THEME_KEY = STORAGE_KEY_THEME;try {
                let saved = localStorage.getItem(THEME_KEY);
if (saved === 'dark' || saved === 'light') {
                    this.isDarkMode = (saved === 'dark');
                } else {
                    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                    this.isDarkMode = !!prefersDark;
                }
            } catch (e) {
                const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                this.isDarkMode = !!prefersDark;
            }
            this.applyTheme();

            if (window.matchMedia) {
                const mq = window.matchMedia('(prefers-color-scheme: dark)');
                const handler = (e) => {
                    if (this._themeAutoFollow !== false) {
                        this.isDarkMode = e.matches;
                        try { localStorage.setItem(THEME_KEY, this.isDarkMode ? 'dark' : 'light'); } catch(_) {}
                        this.applyTheme();
                    }
                };
                try {
                    mq.addEventListener('change', handler);
                } catch (err) {
                    mq.addListener(handler);
                }
                // Store cleanup to prevent leaks (simple and safe)
                this._mqCleanup = () => {
                    try { mq.removeEventListener('change', handler); }
                    catch { mq.removeListener(handler); }
                };
            }
        },

        toggleUILock() {
            this.uiLocked = !this.uiLocked;
            if (this.uiLocked && this.sortableInstance) {
                this.sortableInstance.option('disabled', true);
            } else if (this.sortableInstance) {
                this.sortableInstance.option('disabled', false);
            }
            this.showMenu = false;
        },

        showDescriptionPopup(item) {
            this.selectedItem = item;
            this.showDescriptionModal = true;
        },

        closeDescriptionPopup() {
            this.showDescriptionModal = false;
            this.selectedItem = null;
        },

        removeItem(id) {
            if (this.uiLocked) return;
            
            this.hideActions();
            
            const item = this.items.find(item => item.id === id);
            if (!item) return;
            
            const trashBtn = document.querySelector('.trash-btn');
            if (trashBtn) {
                trashBtn.classList.remove('ring-bounce');
                void trashBtn.offsetWidth;
                trashBtn.classList.add('ring-bounce');
                setTimeout(() => {
                    trashBtn.classList.remove('ring-bounce');
                }, 600);
            }
            
            const element = this.getCardElById(id);
            if (element) {
                element.classList.add('item-deleting');
                setTimeout(() => {
                    this.trashItems.unshift({
                        ...item,
                        deletedAt: new Date().toISOString()
                    });
                    this.items = this.items.filter(item => item.id !== id);
                }, 500);
            } else {
                this.trashItems.unshift({
                    ...item,
                    deletedAt: new Date().toISOString()
                });
                this.items = this.items.filter(item => item.id !== id);
            }
        },

        openTrashModal() {
            this.showTrashModal = true;
        },

        closeTrashModal() {
            this.showTrashModal = false;
        },

        restoreItem(trashItem) {
            this.trashItems = this.trashItems.filter(item => item.id !== trashItem.id);
            const restoredItem = {
                id: trashItem.id,
                text: trashItem.text,
                description: trashItem.description,
                completed: false
            };
            this.items.push(restoredItem);
            
            const element = this.getCardElById(trashItem.id);
            if (element) {
                element.style.animation = 'fadeIn 0.5s ease';
            }
        },

        clearTrash() {
            if (confirm(`휴지통의 모든 항목(${this.trashItems.length}개)을 영구 삭제하시겠습니까?`)) {
                this.trashItems = [];
                this.closeTrashModal();
            }
        },

        closeAllModals() {
            this.showModal = false;
            this.showTrashModal = false;
            this.showDescriptionModal = false;
            this.showPresetModal = false;
            this.showMenu = false;
            this.selectedItem = null;
            this.selectedPresetSlot = null;
        },

        toggleMenu() {
            this.showMenu = !this.showMenu;
        },

        handleOutsideClick(event) {
            if (this.showMenu) {
                const menuButton = this.$refs.menuButton;
                const dropdownMenu = document.querySelector('.dropdown-menu');
                
                if (menuButton && !menuButton.contains(event.target) && 
                    dropdownMenu && !dropdownMenu.contains(event.target)) {
                    this.showMenu = false;
                }
            }
        },

        openPresetModal() {
            this.showPresetModal = true;
            this.showMenu = false;
        },

        closePresetModal() {
            this.showPresetModal = false;
            this.selectedPresetSlot = null;
            // focus restore
            this.$nextTick(() => { try { this.$refs.menuButton && this.$refs.menuButton.focus(); } catch(_) {} });
        },
        selectPresetSlot(slot) {
            this.selectedPresetSlot = slot;
        },

        savePreset() {
            if (!this.selectedPresetSlot) return;
            
            const slotNumber = this.selectedPresetSlot;
            const presetData = {
                title: this.appTitle,
                items: JSON.parse(JSON.stringify(this.items)),
                trashItems: JSON.parse(JSON.stringify(this.trashItems)),
                nextId: this.nextId,
                savedAt: new Date().toISOString()
            };
            
            this.presets[this.selectedPresetSlot] = presetData;
            this.savePresets();
            this.closePresetModal(); this.showToast(`프리셋 ${slotNumber}${this.josa(slotNumber,'이가')} 저장되었습니다.`);
            },

        loadPreset() {
            if (!this.selectedPresetSlot || !this.presets[this.selectedPresetSlot]) return;
            
            const slotNumber = this.selectedPresetSlot;
            const preset = this.presets[this.selectedPresetSlot];
            this.appTitle = preset.title;
            this.items = JSON.parse(JSON.stringify(preset.items || []));
            this.trashItems = JSON.parse(JSON.stringify(preset.trashItems));
            this.nextId = preset.nextId;
            
            this.closePresetModal();
            this.showToast(`프리셋 ${slotNumber}${this.josa(slotNumber,'을를')} 불러왔습니다.`);
        },

        clearPreset() {
            if (!this.selectedPresetSlot || !this.presets[this.selectedPresetSlot]) return;
            const slotNumber = this.selectedPresetSlot;
            if (confirm(`프리셋 ${slotNumber}을 삭제하시겠습니까?`)) {
                delete this.presets[this.selectedPresetSlot];
                this.savePresets();
                this.closePresetModal();
                this.showToast(`프리셋 ${slotNumber}${this.josa(slotNumber,'이가')} 삭제되었습니다.`);
                this.selectedPresetSlot = null;
            }
        },

        resetAll() {
            this.items.forEach(item => {
                item.completed = false;
            });
            this.showMenu = false;
        },

        startEditTitle() {
            if (this.uiLocked) return;
            this.editingTitle = true;
            this.tempTitle = this.appTitle;
            this.$nextTick(() => {
                if (this.$refs.titleInput) {
                    this.$refs.titleInput.focus();
                    this.$refs.titleInput.select();
                }
            });
        },

        saveTitle() {
            if (this.tempTitle.trim()) {
                this.appTitle = this.tempTitle.trim();
            }
            this.editingTitle = false;
            this.tempTitle = '';
        },

        cancelEditTitle() {
            this.editingTitle = false;
            this.tempTitle = '';
        },

        saveToStorage() {
            try {
                const data = {
                    appTitle: this.appTitle,
                    items: this.items,
                    trashItems: this.trashItems,
                    nextId: this.nextId,
                    lastSaved: new Date().toISOString()
                };
                localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(data));
                this._currentData = JSON.stringify(data);
            } catch (error) {
                console.warn('현재 상태 저장 실패:', error);
            }
},

        loadFromStorage() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY_STATE) || this._currentData || null;
                if (!raw) return;
                const data = JSON.parse(raw);
                if (data && typeof data === 'object') {
                    this.appTitle = data.appTitle || this.appTitle || '촬영 체크리스트';
                    this.items = Array.isArray(data.items) ? data.items : this.items;
                    this.trashItems = Array.isArray(data.trashItems) ? data.trashItems : this.trashItems;
                    this.nextId = typeof data.nextId === 'number' ? data.nextId : this.nextId;
                }
            } catch (error) {
                console.warn('현재 상태 로드 실패:', error);
            }
        },

        savePresets() {
            try {
                localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify(this.presets));
                this._presets = JSON.stringify(this.presets);
            } catch (error) {
                console.warn('프리셋 저장 실패:', error);
            }
        },

        loadPresets() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY_PRESETS) || this._presets || null;
                if (raw) this.presets = JSON.parse(raw);
            } catch (error) {
                console.warn('프리셋 로드 실패:', error);
            }
        },

        initSortable() {
            const el = this.$refs.listEl;
            if (el && typeof Sortable !== 'undefined') {
                if (this.sortableInstance) {
                    this.sortableInstance.destroy();
                }
                
                this.sortableInstance = new Sortable(el, {
                    animation: 150,
                    ghostClass: 'sortable-ghost',
                    forceFallback: true,
                    fallbackTolerance: 3,
                    touchStartThreshold: 6,
                    delay: 220,
                    delayOnTouchOnly: true,
                    onStart: (evt) => { 
                        document.body.style.overflow = 'hidden';
                        try {
                            const id = evt.item && evt.item.dataset && evt.item.dataset.id;
                            const el = this.getCardElById(id);
                            if (el) {
                                el.classList.add('dragging');
                                el.classList.remove('drag-arming');
                            }
                        } catch(_){}
                    },
                    onEnd: (evt) => {
                        document.body.style.overflow = '';
                        try {
                            const id = evt.item && evt.item.dataset && evt.item.dataset.id;
                            const el = this.getCardElById(id);
                            if (el) {
                                el.classList.remove('dragging');
                                el.classList.remove('drag-arming');
                            }
                        } catch(_){}
                        const item = this.items.splice(evt.oldIndex, 1)[0];
                        this.items.splice(evt.newIndex, 0, item); 
                    }
                });
            }
        }
    },

    beforeUnmount() {
        try { if (this._mqCleanup) { this._mqCleanup(); } } catch(_) {}
        try { if (this.sortableInstance) { this.sortableInstance.destroy(); } } catch(_) {}
        try { this.clearAllTimers && this.clearAllTimers(); } catch(_) {}
        try { document.removeEventListener('click', this.handleOutsideClick); } catch(_) {}
        try { if (this._toastEl) { this._toastEl.remove(); this._toastEl = null; } } catch(_) {}
    }
});
app.mount('#app');