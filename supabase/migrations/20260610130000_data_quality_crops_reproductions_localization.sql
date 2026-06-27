-- Data quality: normalize localizable system dictionaries only.
-- Product, brand, supplier, variety and hybrid names are intentionally untouched.

update public.crops
set name_ru = 'Картофель',
    name_en = 'Potato',
    name_kz = 'Картоп'
where lower(coalesce(slug, name, name_en, '')) in ('potato', 'potatoes')
   or lower(coalesce(name, '')) in ('potato', 'potatoes', 'картофель');

update public.crops
set name_ru = 'Морковь',
    name_en = 'Carrot',
    name_kz = 'Сәбіз'
where lower(coalesce(slug, name, name_en, '')) = 'carrot'
   or lower(coalesce(name, '')) in ('carrot', 'морковь');

update public.crops
set name_ru = 'Пшеница',
    name_en = 'Wheat',
    name_kz = 'Бидай'
where lower(coalesce(slug, name, name_en, '')) = 'wheat'
   or lower(coalesce(name, '')) in ('wheat', 'пшеница');

update public.crops
set name_ru = 'Кукуруза',
    name_en = 'Corn',
    name_kz = 'Жүгері'
where lower(coalesce(slug, name, name_en, '')) = 'corn'
   or lower(coalesce(name, '')) in ('corn', 'кукуруза');

update public.crops
set name_ru = 'Овёс',
    name_en = 'Oats',
    name_kz = 'Сұлы'
where lower(coalesce(slug, name, name_en, '')) in ('oat', 'oats')
   or lower(coalesce(name, '')) in ('oat', 'oats', 'овес', 'овёс');

update public.crops
set name_ru = 'Горох',
    name_en = 'Peas',
    name_kz = 'Бұршақ'
where lower(coalesce(slug, name, name_en, '')) in ('pea', 'peas')
   or lower(coalesce(name, '')) in ('pea', 'peas', 'горох');

update public.crops
set name_ru = 'Лён',
    name_en = 'Flax',
    name_kz = 'Зығыр'
where lower(coalesce(slug, name, name_en, '')) = 'flax'
   or lower(coalesce(name, '')) in ('flax', 'лен', 'лён');

update public.crops
set name_ru = 'Травосмесь',
    name_en = 'Grass mix',
    name_kz = 'Шөп қоспасы'
where lower(coalesce(slug, name, name_en, '')) in ('grass-mix', 'grass mix')
   or lower(coalesce(name, '')) in ('grass mix', 'травосмесь');

update public.crops
set name_ru = 'Многолетние травы',
    name_en = 'Perennial grass',
    name_kz = 'Көпжылдық шөптер'
where lower(coalesce(slug, name, name_en, '')) in ('perennial-grass', 'perennial grass', 'многолетние-травы')
   or lower(coalesce(name, '')) in ('perennial grass', 'многолетние травы');

update public.crops
set name_ru = 'Бобы',
    name_en = 'Beans',
    name_kz = 'Бұршақ'
where lower(coalesce(slug, name, name_en, '')) = 'beans'
   or lower(coalesce(name, '')) in ('beans', 'бобы');

update public.crops
set name_ru = 'Чечевица',
    name_en = 'Lentils',
    name_kz = 'Жасымық'
where lower(coalesce(slug, name, name_en, '')) = 'lentils'
   or lower(coalesce(name, '')) in ('lentils', 'чечевица');

update public.crops
set name_ru = 'Люцерна',
    name_en = 'Lucerne',
    name_kz = 'Жоңышқа'
where lower(coalesce(slug, name, name_en, '')) = 'lucerne'
   or lower(coalesce(name, '')) in ('lucerne', 'люцерна');

update public.crops
set name_ru = 'Овёс/травосмесь',
    name_en = 'Oats/Grass Mix',
    name_kz = 'Сұлы/шөп қоспасы'
where lower(coalesce(slug, name, name_en, '')) in ('oats-grass-mix', 'oats/grass mix')
   or lower(coalesce(name, '')) in ('oats/grass mix', 'овес/травосмесь', 'овёс/травосмесь');

update public.crops
set name_ru = 'Овощи',
    name_en = 'Vegetables',
    name_kz = 'Көкөністер'
where lower(coalesce(slug, name, name_en, '')) in ('vegetables', 'овощи')
   or lower(coalesce(name, '')) in ('vegetables', 'овощи');

update public.crops
set name_ru = 'Ячмень',
    name_en = 'Barley',
    name_kz = 'Арпа'
where lower(coalesce(slug, name, name_en, '')) = 'barley'
   or lower(coalesce(name, '')) in ('barley', 'ячмень');

update public.crops
set name_ru = 'Подсолнечник',
    name_en = 'Sunflower',
    name_kz = 'Күнбағыс'
where lower(coalesce(slug, name, name_en, '')) = 'sunflower'
   or lower(coalesce(name, '')) in ('sunflower', 'подсолнечник');

update public.crops
set name_ru = 'Суданская трава',
    name_en = 'Sudan grass',
    name_kz = 'Судан шөбі'
where lower(coalesce(slug, name, name_en, '')) in ('sudan-grass', 'sudan grass')
   or lower(coalesce(name, '')) in ('sudan grass', 'суданская трава');

update public.seed_reproductions
set name_ru = 'Оригинальные',
    name_en = 'Original',
    name_kz = 'Оригинал'
where lower(coalesce(code, name, name_en, '')) in ('original', 'оригинальные');

update public.seed_reproductions
set name_ru = 'Элита',
    name_en = 'Elite',
    name_kz = 'Элита'
where lower(coalesce(code, name, name_en, '')) = 'elite'
   or lower(coalesce(name, '')) = 'элита';

update public.seed_reproductions
set name_ru = 'Суперэлита',
    name_en = 'Super elite',
    name_kz = 'Суперэлита'
where lower(coalesce(code, name, name_en, '')) in ('superelite', 'super elite', 'суперэлита');

update public.seed_reproductions
set name_ru = '1 репродукция',
    name_en = 'First reproduction',
    name_kz = '1 репродукция'
where lower(coalesce(code, name, name_en, '')) in ('first reproduction', '1 reproduction', 'r1', '1 репродукция', 'первая репродукция');

update public.seed_reproductions
set name_ru = '2 репродукция',
    name_en = 'Second reproduction',
    name_kz = '2 репродукция'
where lower(coalesce(code, name, name_en, '')) in ('second reproduction', '2 reproduction', 'r2', '2 репродукция', 'вторая репродукция');

update public.seed_reproductions
set name_ru = '3 репродукция',
    name_en = 'Third reproduction',
    name_kz = '3 репродукция'
where lower(coalesce(code, name, name_en, '')) in ('third reproduction', '3 reproduction', 'r3', '3 репродукция', 'третья репродукция');
