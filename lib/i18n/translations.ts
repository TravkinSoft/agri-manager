export type Language = 'ru' | 'en' | 'kz';

export type TranslationKey = keyof typeof translations.ru;

export const translations = {
  ru: {
    // Navigation
    dashboard: 'Панель управления',
    fields: 'Поля',
    crop_structure: 'Структура посевов',
    operations: 'Операции',
    warehouses: 'Склады',
    field_history: 'История полей',
    analytics: 'Аналитика',
    specialist: 'Специалист',
    references: 'Справочники',
    import: 'Импорт',
    settings: 'Настройки',
    users: 'Пользователи',

    // Common
    create: 'Создать',
    edit: 'Редактировать',
    delete: 'Удалить',
    cancel: 'Отмена',
    confirm: 'Подтвердить',
    save: 'Сохранить',
    search: 'Поиск',
    filter: 'Фильтр',
    actions: 'Действия',
    close: 'Закрыть',
    loading: 'Загрузка...',
    error: 'Ошибка',
    success: 'Успешно',
    no_data: 'Нет данных',

    // Fields
    field: 'Поле',
    field_name: 'Название поля',
    field_number: 'Номер поля',
    field_area: 'Площадь',
    field_location: 'Местоположение',
    create_field: 'Создать поле',
    edit_field: 'Редактировать поле',
    total_area: 'Общая площадь',

    // Crop Structure
    crop: 'Культура',
    variety: 'Сорт',
    area: 'Площадь',
    planting_date: 'Дата посева',
    expected_harvest: 'Ожидаемый урожай',
    create_crop_structure: 'Создать структуру посевов',
    edit_crop_structure: 'Редактировать структуру',

    // Operations
    operation: 'Операция',
    operation_type: 'Тип операции',
    operation_date: 'Дата операции',
    notes: 'Примечания',
    create_operation: 'Создать операцию',
    edit_operation: 'Редактировать операцию',
    recent_operations: 'Недавние операции',

    // Operation Types
    planting: 'Посев',
    harvesting: 'Уборка',
    fertilization: 'Удобрение',
    irrigation: 'Орошение',
    spraying: 'Опрыскивание',
    cultivation: 'Культивация',

    // Warehouses
    warehouse: 'Склад',
    warehouse_name: 'Название склада',
    inventory: 'Инвентарь',
    product: 'Продукт',
    quantity: 'Количество',
    unit: 'Единица',
    create_warehouse: 'Создать склад',
    manage_warehouses: 'Управление складами',
    inventory_transactions: 'Складские операции',
    transaction_type: 'Тип операции',
    add_transaction: 'Добавить операцию',

    // Seasons
    season: 'Сезон',
    season_name: 'Название сезона',
    start_date: 'Дата начала',
    end_date: 'Дата окончания',
    create_season: 'Создать сезон',

    // Dashboard
    total_fields: 'Всего полей',
    active_operations: 'Активные операции',
    total_inventory: 'Всего на складе',
    crop_distribution: 'Распределение культур',
    inventory_snapshot: 'Складские остатки',

    // Analytics
    yield_analysis: 'Анализ урожайности',
    operation_efficiency: 'Эффективность операций',
    cost_analysis: 'Анализ затрат',

    // Specialist (AI Assistant)
    ai_specialist: 'AI Специалист',
    ask_question: 'Задайте вопрос...',
    send: 'Отправить',
    chat_placeholder: 'Спросите меня о ваших полях, культурах или операциях...',

    // Draft Operation
    operation_draft: 'Черновик операции',
    draft_created: 'Создан черновик операции',
    review_and_confirm: 'Проверьте и подтвердите',
    edit_draft: 'Редактировать',
    confirm_draft: 'Подтвердить',
    cancel_draft: 'Отменить',
    operation_created: 'Операция успешно создана',
    operation_cancelled: 'Черновик отменен',

    // Validation
    field_required: 'Поле обязательно',
    date_required: 'Дата обязательна',
    operation_type_required: 'Тип операции обязателен',
    invalid_field: 'Поле не найдено',
    invalid_date: 'Некорректная дата',

    // Units
    hectares: 'га',
    tons: 'т',
    kg: 'кг',
    liters: 'л',
    pieces: 'шт',
  },

  en: {
    // Navigation
    dashboard: 'Dashboard',
    fields: 'Fields',
    crop_structure: 'Crop Structure',
    operations: 'Operations',
    warehouses: 'Warehouses',
    field_history: 'Field History',
    analytics: 'Analytics',
    specialist: 'Specialist',
    references: 'References',
    import: 'Import',
    settings: 'Settings',
    users: 'Users',

    // Common
    create: 'Create',
    edit: 'Edit',
    delete: 'Delete',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    search: 'Search',
    filter: 'Filter',
    actions: 'Actions',
    close: 'Close',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    no_data: 'No data',

    // Fields
    field: 'Field',
    field_name: 'Field Name',
    field_number: 'Field Number',
    field_area: 'Area',
    field_location: 'Location',
    create_field: 'Create Field',
    edit_field: 'Edit Field',
    total_area: 'Total Area',

    // Crop Structure
    crop: 'Crop',
    variety: 'Variety',
    area: 'Area',
    planting_date: 'Planting Date',
    expected_harvest: 'Expected Harvest',
    create_crop_structure: 'Create Crop Structure',
    edit_crop_structure: 'Edit Structure',

    // Operations
    operation: 'Operation',
    operation_type: 'Operation Type',
    operation_date: 'Operation Date',
    notes: 'Notes',
    create_operation: 'Create Operation',
    edit_operation: 'Edit Operation',
    recent_operations: 'Recent Operations',

    // Operation Types
    planting: 'Planting',
    harvesting: 'Harvesting',
    fertilization: 'Fertilization',
    irrigation: 'Irrigation',
    spraying: 'Spraying',
    cultivation: 'Cultivation',

    // Warehouses
    warehouse: 'Warehouse',
    warehouse_name: 'Warehouse Name',
    inventory: 'Inventory',
    product: 'Product',
    quantity: 'Quantity',
    unit: 'Unit',
    create_warehouse: 'Create Warehouse',
    manage_warehouses: 'Manage Warehouses',
    inventory_transactions: 'Inventory Transactions',
    transaction_type: 'Transaction Type',
    add_transaction: 'Add Transaction',

    // Seasons
    season: 'Season',
    season_name: 'Season Name',
    start_date: 'Start Date',
    end_date: 'End Date',
    create_season: 'Create Season',

    // Dashboard
    total_fields: 'Total Fields',
    active_operations: 'Active Operations',
    total_inventory: 'Total Inventory',
    crop_distribution: 'Crop Distribution',
    inventory_snapshot: 'Inventory Snapshot',

    // Analytics
    yield_analysis: 'Yield Analysis',
    operation_efficiency: 'Operation Efficiency',
    cost_analysis: 'Cost Analysis',

    // Specialist (AI Assistant)
    ai_specialist: 'AI Specialist',
    ask_question: 'Ask a question...',
    send: 'Send',
    chat_placeholder: 'Ask me about your fields, crops, or operations...',

    // Draft Operation
    operation_draft: 'Operation Draft',
    draft_created: 'Operation draft created',
    review_and_confirm: 'Review and confirm',
    edit_draft: 'Edit',
    confirm_draft: 'Confirm',
    cancel_draft: 'Cancel',
    operation_created: 'Operation created successfully',
    operation_cancelled: 'Draft cancelled',

    // Validation
    field_required: 'Field is required',
    date_required: 'Date is required',
    operation_type_required: 'Operation type is required',
    invalid_field: 'Field not found',
    invalid_date: 'Invalid date',

    // Units
    hectares: 'ha',
    tons: 't',
    kg: 'kg',
    liters: 'l',
    pieces: 'pcs',
  },

  kz: {
    // Navigation
    dashboard: 'Басқару панелі',
    fields: 'Алаңдар',
    crop_structure: 'Егін құрылымы',
    operations: 'Операциялар',
    warehouses: 'Қоймалар',
    field_history: 'Алаңдар тарихы',
    analytics: 'Аналитика',
    specialist: 'Маман',
    references: 'Анықтамалықтар',
    import: 'Импорт',
    settings: 'Баптаулар',
    users: 'Қолданушылар',

    // Common
    create: 'Құру',
    edit: 'Өңдеу',
    delete: 'Жою',
    cancel: 'Болдырмау',
    confirm: 'Растау',
    save: 'Сақтау',
    search: 'Іздеу',
    filter: 'Сүзгі',
    actions: 'Әрекеттер',
    close: 'Жабу',
    loading: 'Жүктелуде...',
    error: 'Қате',
    success: 'Сәтті',
    no_data: 'Деректер жоқ',

    // Fields
    field: 'Алаң',
    field_name: 'Алаң атауы',
    field_number: 'Алаң нөмірі',
    field_area: 'Аумағы',
    field_location: 'Орналасуы',
    create_field: 'Алаң құру',
    edit_field: 'Алаңды өңдеу',
    total_area: 'Жалпы аумақ',

    // Crop Structure
    crop: 'Дақыл',
    variety: 'Сорт',
    area: 'Аумақ',
    planting_date: 'Егу күні',
    expected_harvest: 'Күтілетін өнім',
    create_crop_structure: 'Егін құрылымын құру',
    edit_crop_structure: 'Құрылымды өңдеу',

    // Operations
    operation: 'Операция',
    operation_type: 'Операция түрі',
    operation_date: 'Операция күні',
    notes: 'Ескертпелер',
    create_operation: 'Операция құру',
    edit_operation: 'Операцияны өңдеу',
    recent_operations: 'Соңғы операциялар',

    // Operation Types
    planting: 'Егу',
    harvesting: 'Жинау',
    fertilization: 'Тыңайтқыштау',
    irrigation: 'Суару',
    spraying: 'Шашу',
    cultivation: 'Өңдеу',

    // Warehouses
    warehouse: 'Қойма',
    warehouse_name: 'Қойма атауы',
    inventory: 'Қор',
    product: 'Өнім',
    quantity: 'Саны',
    unit: 'Өлшем бірлігі',
    create_warehouse: 'Қойма құру',
    manage_warehouses: 'Қоймаларды басқару',
    inventory_transactions: 'Қойма операциялары',
    transaction_type: 'Операция түрі',
    add_transaction: 'Операция қосу',

    // Seasons
    season: 'Маусым',
    season_name: 'Маусым атауы',
    start_date: 'Басталу күні',
    end_date: 'Аяқталу күні',
    create_season: 'Маусым құру',

    // Dashboard
    total_fields: 'Барлық алаңдар',
    active_operations: 'Белсенді операциялар',
    total_inventory: 'Барлық қор',
    crop_distribution: 'Дақылдарды бөлу',
    inventory_snapshot: 'Қойма қалдықтары',

    // Analytics
    yield_analysis: 'Өнімділік талдауы',
    operation_efficiency: 'Операциялар тиімділігі',
    cost_analysis: 'Шығын талдауы',

    // Specialist (AI Assistant)
    ai_specialist: 'AI Маман',
    ask_question: 'Сұрақ қойыңыз...',
    send: 'Жіберу',
    chat_placeholder: 'Алаңдар, дақылдар немесе операциялар туралы сұраңыз...',

    // Draft Operation
    operation_draft: 'Операция жобасы',
    draft_created: 'Операция жобасы құрылды',
    review_and_confirm: 'Тексеріп растаңыз',
    edit_draft: 'Өңдеу',
    confirm_draft: 'Растау',
    cancel_draft: 'Болдырмау',
    operation_created: 'Операция сәтті құрылды',
    operation_cancelled: 'Жоба болдырылмады',

    // Validation
    field_required: 'Алаң міндетті',
    date_required: 'Күн міндетті',
    operation_type_required: 'Операция түрі міндетті',
    invalid_field: 'Алаң табылмады',
    invalid_date: 'Қате күн',

    // Units
    hectares: 'га',
    tons: 'т',
    kg: 'кг',
    liters: 'л',
    pieces: 'дана',
  },
};
