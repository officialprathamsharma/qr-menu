"""Generates data/arabico.json — demo menu for Arabico Specialty Coffee, Janakpuri (New Delhi).

Item names, sections and prices follow Arabico's public Zomato listing (Nov 2026).
Descriptions (other than Zomato's own), prep times, badges, kcal and pairings are
ILLUSTRATIVE placeholders for the demo — confirm with the owner before going live.
Photos: Unsplash (free licence). Videos + their poster frames: Mixkit (free licence).
"""
import json, pathlib

IMG = "https://images.unsplash.com/photo-{}?w=900&q=70&auto=format&fit=crop"
VID = "https://assets.mixkit.co/videos/{0}/{0}-720.mp4"
POSTER = "https://assets.mixkit.co/videos/{0}/{0}-thumb-720-0.jpg"

dishes = []

def add(id, name, cat, price, prep, media, desc, *, tags=(), badges=(), veg=True, egg=False,
        vegan=False, spice=0, kcal=None, story=None, note=None, pair=(), allergens=()):
    """media: an Unsplash photo id, or an int Mixkit video id (poster frame comes from the video)."""
    d = {"id": id, "name": name, "category": cat, "price": price, "prepTime": prep}
    if isinstance(media, int):
        d["image"], d["video"] = POSTER.format(media), VID.format(media)
    else:
        d["image"] = IMG.format(media)
    d.update(description=desc, tags=list(tags), badges=list(badges),
             diet={"veg": veg, "egg": egg, "vegan": vegan, "gf": False}, spice=spice)
    if kcal: d["kcal"] = kcal
    if story: d["story"] = story
    if note: d["chefNote"] = note
    if pair: d["pairings"] = [{"kind": k, "dishId": i, "note": n} for k, i, n in pair]
    if allergens: d["allergens"] = list(allergens)
    dishes.append(d)

MILK, GLU = "dairy", "gluten"

# ---------------- Matcha ----------------
add("og-matcha", "OG Matcha", "matcha", 259, 5, 21882,
    "Ceremonial-grade matcha whisked smooth and poured over steamed milk.",
    tags=["most-loved"], badges=["new"], kcal=170, allergens=[MILK],
    story="Whisked to order, never pre-mixed — the way matcha should taste: grassy, sweet and a little bit earthy.",
    pair=[("Bite", "pesto-mushroom-toast", "Earthy meets earthy.")])
add("berry-dreams", "Berry Dreams", "matcha", 299, 6, "1717398804998-ad2d48822518",
    "Iced matcha layered over a house berry compote and cold milk.", tags=["barista"], badges=["new"], kcal=210, allergens=[MILK])
add("coco-cloud", "Coco Cloud", "matcha", 279, 6, "1717603545758-88cc454db69b",
    "Iced matcha crowned with whipped coconut foam.", vegan=True, kcal=190)
add("oat-gold", "Oat Gold", "matcha", 299, 6, "1749280447307-31a68eb38673",
    "Matcha shaken with creamy oat milk and a touch of honey.", kcal=200)
add("summer-glow", "Summer Glow", "matcha", 299, 6, "1775846933630-3c1531299e5a",
    "A bright iced matcha with tropical fruit notes — sunshine in a glass.", kcal=180, allergens=[MILK])
add("sweet-vanilla", "Sweet Vanilla", "matcha", 279, 5, "1766426910014-63a302fa137e",
    "Matcha latte sweetened with real vanilla bean.", kcal=200, allergens=[MILK])

# ---------------- Specialty coffee ----------------
add("iced-coco-latte", "Iced Coco Latte", "specialty", 369, 6, 796,
    "Chilled espresso topped with thick, velvety coconut foam.",
    tags=["most-loved"], badges=["bestseller"], kcal=190,
    note="Pull the shot, chill it fast, then let the coconut foam sink in slowly. Don't stir — sip through the layers.",
    pair=[("Bite", "chicken-pesto-sandwich", "Creamy coffee, herby crunch.")])
add("iced-freddo-cappuccino", "Iced Freddo Cappuccino", "specialty", 379, 6, "1562447457-579fc34967fb",
    "Chilled espresso served over ice and topped with thick, creamy cold foam.", tags=["barista"], kcal=150, allergens=[MILK])
add("pineapple-trifecta", "Pineapple Trifecta", "specialty", 369, 7, "1762883469122-c15463bbce28",
    "Iced coffee infused with pineapple for a bright, tropical kick.",
    tags=["barista"], badges=["signature"], vegan=True, kcal=140,
    story="Coffee and pineapple sound strange together until the first sip: the fruit lifts the coffee's natural acidity.")
add("spanish-iced-latte", "Spanish Iced Latte", "specialty", 329, 5, "1592663527359-cf6642f54cff",
    "Iced espresso sweetened with creamy condensed milk.", tags=["most-loved"], badges=["bestseller"], kcal=240, allergens=[MILK])
add("tangerine-iced-coffee", "Tangerine Iced Coffee", "specialty", 369, 6, "1769737184213-af66b3637edb",
    "Iced coffee flavoured with fresh tangerine for a bright, citrusy kick.", tags=["barista"], vegan=True, kcal=130)
add("vanilla-sweet-cream-brew", "Vanilla Sweet Cream Brew", "specialty", 379, 5, "1771210849472-84a07b2e793a",
    "Slow-steeped cold brew finished with a pour of vanilla sweet cream.", tags=["barista"], kcal=220, allergens=[MILK])
add("vietnamese-iced-coffee", "Vietnamese Iced Coffee", "specialty", 339, 6, "1559496417-e7f25cb247f3",
    "Strong brewed coffee mixed with sweet condensed milk and poured over ice.", tags=["most-loved"], kcal=230, allergens=[MILK])

# ---------------- Hot coffee ----------------
add("americano", "Americano", "hot", 229, 4, 41865,
    "A double shot of our house espresso, lengthened with hot water.", vegan=True, kcal=10)
add("arabico-hot-chocolate", "Arabico Hot Chocolate", "hot", 339, 6, "1542990253-0d0f5be5f0ed",
    "Thick, rich house hot chocolate made with real cocoa.", badges=["signature"], kcal=320, allergens=[MILK])
add("biscoff-latte", "Biscoff Latte", "hot", 329, 5, 810,
    "Espresso and steamed milk with caramelised Biscoff spread and a cookie crumble.",
    tags=["most-loved"], badges=["bestseller"], kcal=280, allergens=[MILK, GLU],
    story="The drink our regulars rave about — warm caramelised-biscuit spice, silky microfoam and a crumble on top.",
    note="Sip it first without stirring — the Biscoff sits at the bottom and gets better with every mouthful.",
    pair=[("Bite", "pesto-mushroom-toast", "Sweet latte, savoury toast."), ("Bite", "cheesy-fries", "Trust us on this one.")])
add("cappuccino", "Cappuccino", "hot", 289, 4, 41859,
    "Equal parts espresso, steamed milk and airy foam.", kcal=120, allergens=[MILK])
add("honey-cinnamon-latte", "Honey Cinnamon Latte", "hot", 319, 5, 88008,
    "Latte sweetened with wild honey and a warm dusting of cinnamon.", tags=["barista"], kcal=210, allergens=[MILK])
add("latte", "Latte", "hot", 289, 4, "1761783768352-e7f42bfa9988",
    "Espresso with silky steamed milk and a thin layer of foam.", kcal=150, allergens=[MILK])
add("mocha", "Mocha", "hot", 319, 5, 43935,
    "Espresso, dark chocolate and steamed milk.", kcal=260, allergens=[MILK])
add("spanish-latte", "Spanish Latte", "hot", 319, 5, "1785037358154-1c32247ee9da",
    "Hot latte sweetened with condensed milk.", kcal=230, allergens=[MILK])

# ---------------- Cold coffee ----------------
add("coffee-lemonade", "Coffee Lemonade", "cold", 329, 5, "1656936637945-571e3f0893f9",
    "Espresso over fresh lemonade — tart, sparkling and surprisingly refreshing.", vegan=True, kcal=110)
add("coffee-tonic", "Coffee Tonic", "cold", 329, 4, "1544241907-f3f1f5ded15a",
    "A shot of espresso floated over chilled tonic water and ice.", tags=["barista"], vegan=True, kcal=90)
add("cranberry-coffee", "Cranberry Coffee", "cold", 329, 5, "1499638673689-79a0b5115d87",
    "Iced coffee with tangy cranberry.", vegan=True, kcal=120)
add("iced-americano", "Iced Americano", "cold", 259, 3, "1581996323441-538096e854b9",
    "Double espresso over ice and cold water.", vegan=True, kcal=10)
add("iced-cappuccino", "Iced Cappuccino", "cold", 299, 4, "1461023058943-07fcbe16d735",
    "Espresso, cold milk and foam over ice.", kcal=130, allergens=[MILK])
add("iced-caramel-macchiato", "Iced Caramel Macchiato", "cold", 339, 5, "1517701550927-30cf4ba1dba5",
    "Vanilla milk over ice, marked with espresso and a caramel drizzle.", kcal=250, allergens=[MILK])
add("iced-latte", "Iced Latte", "cold", 299, 4, "1764298490445-6add12301888",
    "Espresso and cold milk over ice.", kcal=140, allergens=[MILK])
add("iced-mocha", "Iced Mocha", "cold", 339, 5, "1578314675249-a6910f80cc4e",
    "Espresso, chocolate and cold milk over ice.", kcal=260, allergens=[MILK])
add("frappe", "Frappe", "cold", 259, 5, "1718267050202-9b1b6bfb8545",
    "Coffee blended with ice cream until thick and frosty.", kcal=380, allergens=[MILK])

# ---------------- Teas & coolers ----------------
add("honey-ginger-lemon-tea", "Honey Ginger Lemon Tea", "teas", 239, 5, 22268,
    "Freshly brewed with ginger, lemon and honey — a hug in a cup.", kcal=60)
add("iced-hibiscus-mint-tea", "Iced Hibiscus Mint Tea", "teas", 229, 4, "1499961024600-ad094db305cc",
    "Ruby-red hibiscus brewed cold with fresh mint.", vegan=True, kcal=50)
add("lemon-green-tea", "Lemon Green Tea", "teas", 239, 4, 9267,
    "Light green tea brewed with a squeeze of lemon.", vegan=True, kcal=5)
add("peach-iced-tea", "Peach Iced Tea", "teas", 229, 4, "1556679343-c7306c1976bc",
    "House-brewed black tea with ripe peach, over ice.", vegan=True, kcal=90)
add("zero-sugar-iced-tea", "Zero Sugar Iced Tea", "teas", 229, 4, "1758705206938-a196ac3ae3bb",
    "All the refreshment, none of the sugar.", vegan=True, kcal=5)
add("blueberry-mojito", "Blueberry Mojito", "teas", 259, 5, "1782849205997-335c93fdc6c8",
    "Muddled blueberries, lime and mint topped with soda (non-alcoholic).", vegan=True, kcal=120)
add("passion-mojito", "Passion Mojito", "teas", 259, 5, "1775717427643-2b0fc39a81f8",
    "Passion fruit, lime and mint with soda (non-alcoholic).", vegan=True, kcal=120)

# ---------------- Salads ----------------
add("og-caesar", "OG Caesar", "bowls", 329, 10, "1550304943-4f24f54ddde9",
    "Crisp romaine, garlic croutons, parmesan and a classic Caesar dressing.", kcal=320, allergens=[MILK, GLU])
add("veg-house-special", "Veg House Special with Peanut Dressing", "bowls", 349, 10, "1505576633757-0ac1084af824",
    "Crunchy greens and vegetables tossed in a sweet-savoury peanut dressing.", kcal=360, allergens=["peanuts"])
add("veg-mexican-salad", "Veg Mexican Salad", "bowls", 349, 10, 21529,
    "Beans, corn, peppers and greens with a zesty lime dressing.", spice=1, kcal=340)

# ---------------- Sandwiches & toast ----------------
add("basil-mushroom-sandwich", "Basil Mushroom Sandwich", "sandwiches", 349, 12, "1709689156424-16fe0e05b47b",
    "Sautéed mushrooms, fresh basil and melted cheese, grilled golden.", kcal=480, allergens=[MILK, GLU])
add("chicken-pesto-sandwich", "Chicken Pesto Sandwich", "sandwiches", 379, 12, 3069,
    "Grilled chicken, basil pesto, lettuce and tomato on toasted bread.",
    tags=["most-loved"], badges=["bestseller"], veg=False, kcal=540, allergens=[MILK, GLU, "nuts"],
    pair=[("Drink", "iced-coco-latte", "Our most-ordered combo."), ("Side", "salted-fries", "Make it a meal.")])
add("chicken-hummus-sandwich", "Classic Chicken Hummus Sandwich", "sandwiches", 379, 12, "1712746784291-e29d5d2694d4",
    "Pulled chicken with house hummus, cucumber and greens.", veg=False, kcal=520, allergens=[GLU, "sesame"])
add("delhi-chicken-sandwich", "Delhi Style Chicken Sandwich", "sandwiches", 339, 12, "1676300184084-de35d56a9a70",
    "Spiced tandoori-style chicken with onions and mint mayo.", veg=False, spice=2, kcal=510, allergens=[GLU, "egg"])
add("garden-hummus-sandwich", "Garden Hummus Sandwich", "sandwiches", 349, 10, "1534352211968-8d25dbe0e951",
    "House hummus, roasted vegetables and fresh greens.", vegan=True, kcal=420, allergens=[GLU, "sesame"])
add("homestyle-paneer-sandwich", "Homestyle Paneer Sandwich", "sandwiches", 329, 12, "1496113269490-84ffe1a410cb",
    "Masala paneer, onions and capsicum, toasted crisp.", spice=1, kcal=490, allergens=[MILK, GLU])
add("saucy-chicken", "Saucy Chicken", "sandwiches", 339, 12, "1709689155464-90d6ca1e9f62",
    "Juicy chicken in a tangy house sauce, grilled in thick bread.", veg=False, spice=1, kcal=530, allergens=[GLU])
add("veg-club-sandwich", "Veg Club Sandwich", "sandwiches", 319, 10, 26094,
    "Triple-decker with veggies, cheese, lettuce and tomato.", kcal=460, allergens=[MILK, GLU])
add("pesto-mushroom-toast", "Pesto Mushroom Toast", "sandwiches", 329, 10, "1760731755984-442f86f9b744",
    "Open sourdough toast with garlicky mushrooms and basil pesto.", kcal=390, allergens=[GLU, "nuts"])

# ---------------- Eggs & rolls ----------------
add("classic-chicken-roll", "Classic Chicken Roll", "eggs", 329, 12, "1719282431565-3b30bb7d2658",
    "Spiced chicken rolled in a flaky egg-coated paratha.", veg=False, spice=1, kcal=560, allergens=[GLU, "egg"])
add("scrambled-eggs-toast", "Scrambled Eggs Toast", "eggs", 339, 10, 42909,
    "Soft, buttery scrambled eggs on toasted bread.", veg=False, egg=True, kcal=420, allergens=["egg", MILK, GLU])
add("arabico-omelette-plate", "The Arabico Omelette Plate", "eggs", 369, 12, 42910,
    "A fluffy three-egg omelette with toast and a side salad.", veg=False, egg=True, badges=["signature"],
    kcal=480, allergens=["egg", MILK, GLU])

# ---------------- Wraps ----------------
add("chicken-chipotle-wrap", "Chicken Chipotle Wrap", "wraps", 389, 12, "1646530208887-8a791bff4701",
    "Smoky chipotle chicken, lettuce and cheese in a soft tortilla.", veg=False, badges=["spicy"], spice=2, kcal=560, allergens=[GLU, MILK])
add("chicken-hummus-wrap", "Classic Chicken & Hummus Wrap", "wraps", 389, 12, "1632660346941-023cc64e1252",
    "Grilled chicken, hummus and crunchy salad, rolled tight.", veg=False, kcal=540, allergens=[GLU, "sesame"])
add("classic-falafel-wrap", "Classic Falafel Wrap", "wraps", 379, 12, "1788538397125-8fef2bf2af0b",
    "Crispy falafel, hummus, pickles and greens in a toasted wrap.", tags=["most-loved"], vegan=True,
    kcal=520, allergens=[GLU, "sesame"])
add("delhi-chicken-wrap", "Delhi Style Chicken Wrap", "wraps", 389, 12, "1734772591537-15ac1b3b3c04",
    "Tandoori-spiced chicken with onions and mint chutney.", veg=False, spice=2, kcal=550, allergens=[GLU])
add("exotic-mushroom-wrap", "Exotic Mushroom Wrap", "wraps", 379, 12, "1760888548893-bc2f7e09e972",
    "A medley of sautéed mushrooms with herbs and cheese.", kcal=480, allergens=[GLU, MILK])
add("exotic-veggies-wrap", "Exotic Veggies Wrap", "wraps", 379, 12, "1681072530653-db8fe2538631",
    "Grilled zucchini, peppers, broccoli and a creamy dressing.", kcal=460, allergens=[GLU, MILK])

# ---------------- Large plates ----------------
add("grilled-chicken", "Grilled Chicken", "bowls", 399, 18, "1777891258069-454e66f8bedc",
    "Herb-marinated grilled chicken with sautéed vegetables.", veg=False, kcal=520)
add("protein-bowl", "Protein Bowl", "bowls", 379, 12, "1542354255-839e272e3408",
    "Chickpeas, paneer, grains and fresh vegetables — fuel in a bowl.", kcal=540, allergens=[MILK])
add("veg-burrito-bowl", "Veg Classic Burrito Bowl", "bowls", 379, 14, "1520066391310-428f06ebd602",
    "Mexican rice, beans, corn, salsa and sour cream.", spice=1, kcal=580, allergens=[MILK])
add("veg-thai-rice-bowl", "Veg Thai Rice Bowl", "bowls", 379, 15, "1788016487973-edef419585f0",
    "Fragrant Thai curry with vegetables over steamed rice.", spice=2, kcal=560)

# ---------------- Pasta ----------------
add("aglio-e-olio", "Aglio e Olio Pasta", "pasta", 339, 14, 24463,
    "Spaghetti tossed with garlic, olive oil and chilli flakes.", spice=1, kcal=480, allergens=[GLU])
add("alfredo-pasta", "Alfredo Pasta", "pasta", 339, 14, 2436,
    "Creamy parmesan white sauce with herbs.", tags=["most-loved"], kcal=620, allergens=[GLU, MILK],
    pair=[("Drink", "peach-iced-tea", "Cuts through the cream.")])
add("arrabbiata-pasta", "Arrabbiata Pasta", "pasta", 339, 14, "1598866594230-a7c12756260f",
    "Penne in a spicy tomato and garlic sauce.", spice=2, kcal=500, allergens=[GLU])
add("coco-curry-pasta", "Coco Curry Pasta", "pasta", 359, 15, "1567608285969-48e4bbe0d399",
    "Pasta in a mild coconut curry sauce. Add chicken for ₹49.", spice=1, kcal=590, allergens=[GLU])
add("creamy-pesto-pasta", "Creamy Pesto Pasta", "pasta", 349, 14, "1473093295043-cdd812d0e601",
    "Basil pesto folded into a light cream sauce.", kcal=600, allergens=[GLU, MILK, "nuts"])
add("k-night-pasta", "K-Night Pasta", "pasta", 359, 15, "1612966893103-790e549a2ab1",
    "Korean-inspired gochujang cream pasta with a gentle kick.", badges=["new"], spice=2, kcal=610, allergens=[GLU, MILK])
add("rose-pasta", "Rose Pasta", "pasta", 349, 14, "1621996346565-e3dbc646d9a9",
    "Half tomato, half cream — the best of both sauces.", kcal=580, allergens=[GLU, MILK])

# ---------------- Pizza ----------------
add("delhi-chicken-pizza", "Delhi Style Chicken Pizza", "pizza", 389, 16, 1666,
    "Tandoori chicken, onions and capsicum on a cheesy base.", veg=False, spice=1, kcal=880, allergens=[GLU, MILK])
add("farmhouse-pizza", "Farmhouse Pizza", "pizza", 359, 15, "1574071318508-1cdbab80d002",
    "Onion, capsicum, tomato, mushroom and corn.", kcal=780, allergens=[GLU, MILK])
add("margherita-pizza", "Margherita Pizza", "pizza", 299, 14, "1513104890138-7c749659a591",
    "Tomato sauce, mozzarella and basil — simple and perfect.", kcal=700, allergens=[GLU, MILK])
add("pesto-margherita-pizza", "Pesto Margherita Pizza", "pizza", 339, 14, "1598023696416-0193a0bcd302",
    "Margherita with a swirl of basil pesto.", kcal=740, allergens=[GLU, MILK, "nuts"])
add("pesto-olive-mushroom-pizza", "Pesto Olive & Mushroom Pizza", "pizza", 359, 15, "1564936281291-294551497d81",
    "Pesto base, black olives, mushrooms and mozzarella.", kcal=790, allergens=[GLU, MILK, "nuts"])
add("truffle-mushroom-pizza", "Truffle Mushroom Pizza", "pizza", 389, 16, "1759283391598-83b0ceb0faef",
    "Wild mushrooms, mozzarella and a drizzle of truffle oil.", tags=["most-loved"], badges=["bestseller"],
    kcal=820, allergens=[GLU, MILK],
    pair=[("Drink", "coffee-tonic", "Bitter, bubbly, perfect with truffle.")])

# ---------------- Fries & dips ----------------
add("cheesy-fries", "Cheesy Fries", "fries", 359, 10, "1639744210631-209fce3e256c",
    "Golden fries smothered in hot cheese sauce.", kcal=560, allergens=[MILK])
add("exotic-mushroom-fries", "Exotic Mushroom Fries", "fries", 389, 12, "1684815495679-f6e6bc0634ec",
    "Fries loaded with garlicky sautéed mushrooms and herbs.", kcal=580, allergens=[MILK])
add("peri-peri-fries", "Peri-Peri Fries", "fries", 359, 10, 3539,
    "Crispy fries tossed in fiery peri-peri seasoning.", tags=["most-loved"], badges=["spicy"], spice=2, vegan=True, kcal=480)
add("salted-fries", "Salted Fries", "fries", 339, 8, 3549,
    "Classic, crisp and lightly salted.", vegan=True, kcal=420)
add("veg-loaded-fries", "Veg Loaded Fries", "fries", 359, 12, "1666304752980-678d5c35c911",
    "Fries piled with cheese, jalapeños, salsa and veggies.", spice=1, kcal=620, allergens=[MILK])
add("classic-hummus", "Classic Hummus", "fries", 99, 2, "1637949385162-e416fb15b2ce",
    "In-house chickpea and tahini dip.", vegan=True, allergens=["sesame"])
add("avocado-dip", "Creamy Avocado Dip", "fries", 129, 2, "1680992071073-cb1696ba8d3e",
    "Smashed avocado with lime and herbs.", vegan=True)
add("tomato-salsa", "Fresh Tomato Salsa", "fries", 99, 2, "1533606117812-0783e8e690f1",
    "Chunky tomato, onion and coriander salsa.", vegan=True, spice=1)
add("mint-dip", "Mint Dip", "fries", 39, 1, "1620019989549-bbb873b6612d", "Cool mint and yoghurt.", allergens=[MILK])
add("peri-peri-dip", "Peri-Peri Dip", "fries", 39, 1, "1783696072732-2ff5cec23b08", "Creamy and fiery.", spice=2)
add("tandoori-dip", "Tandoori Dip", "fries", 39, 1, "1697126248475-a537cc5cce28", "Smoky tandoori mayo.", spice=1)

data = {
    "id": "arabico",
    "name": "Arabico",
    "tagline": "Specialty coffee · Janakpuri",
    "chef": "The Arabico baristas",
    "logo": None,
    "currency": "INR",
    "locale": "en-IN",
    "theme": {"primary": "#D4A373", "secondary": "#6B8F4E"},
    "footerNote": "Prices are in ₹ and exclusive of taxes. Please tell our team about any allergies.",
    "branches": [{"id": "janakpuri", "name": "Arabico — Janakpuri", "lat": None, "lng": None, "radiusM": 150}],
    "badges": {
        "bestseller": {"label": "Bestseller", "tone": "primary"},
        "signature": {"label": "Signature", "tone": "secondary"},
        "new": {"label": "New", "tone": "neutral"},
        "spicy": {"label": "Spicy", "tone": "neutral"},
    },
    "sections": [
        {"id": "most-loved", "label": "Most loved at {name}", "type": "tag", "match": "most-loved",
         "eyebrow": "Guest favourites", "description": "The cups and plates our regulars order again and again.",
         "order": ["biscoff-latte", "iced-coco-latte", "chicken-pesto-sandwich", "truffle-mushroom-pizza", "og-matcha",
                   "spanish-iced-latte", "peri-peri-fries", "classic-falafel-wrap", "vietnamese-iced-coffee", "alfredo-pasta"]},
        {"id": "barista-picks", "label": "Barista's Picks", "type": "tag", "match": "barista",
         "eyebrow": "From behind the bar", "description": "What our baristas are drinking this week."},
        {"id": "matcha", "label": "Matcha", "type": "category", "match": "matcha", "eyebrow": "Whisked to order"},
        {"id": "specialty", "label": "Specialty Coffee", "type": "category", "match": "specialty", "eyebrow": "Signature creations"},
        {"id": "hot", "label": "Hot Coffee", "type": "category", "match": "hot", "eyebrow": "As hot as you"},
        {"id": "cold", "label": "Cold Coffee", "type": "category", "match": "cold", "eyebrow": "If you like it cold"},
        {"id": "teas", "label": "Teas & Coolers", "type": "category", "match": "teas", "eyebrow": "Freshly brewed"},
        {"id": "sandwiches", "label": "Sandwiches & Toast", "type": "category", "match": "sandwiches", "eyebrow": "Between the slices"},
        {"id": "eggs", "label": "Eggs & Rolls", "type": "category", "match": "eggs", "eyebrow": "Eggstation"},
        {"id": "wraps", "label": "Wraps", "type": "category", "match": "wraps", "eyebrow": "It's a wrap"},
        {"id": "bowls", "label": "Bowls & Salads", "type": "category", "match": "bowls", "eyebrow": "Comforting large plates"},
        {"id": "pasta", "label": "Pasta", "type": "category", "match": "pasta", "eyebrow": "Fresh off the stove"},
        {"id": "pizza", "label": "Pizza", "type": "category", "match": "pizza", "eyebrow": "Hot from the oven"},
        {"id": "fries", "label": "Fries & Dips", "type": "category", "match": "fries", "eyebrow": "Something on the side"},
    ],
    "dishes": dishes,
}

ids = [d["id"] for d in dishes]
assert len(ids) == len(set(ids)), "duplicate dish id"
for d in dishes:
    for p in d.get("pairings", []):
        assert p["dishId"] in ids, f"bad pairing {p['dishId']} in {d['id']}"

out = pathlib.Path(__file__).resolve().parent.parent / "data" / "arabico.json"
out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {out}: {len(dishes)} dishes, {sum('video' in d for d in dishes)} with video")
