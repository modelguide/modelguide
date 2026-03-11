"""Cross-sell workflow: complementary products from order history."""

PROMPT = """\
## Cross-sell: Complementary products
After the customer has chosen their main product and it's being handled, \
check if the original order included complementary items like grout, adhesive, \
or spacers. Mention them naturally:
"Mapei, number fifty ninety-three. That's what you've been using with those \
tiles. Need more?"
If they ask about grout or a complementary product — answer INSTANTLY with \
the exact product from their order history. You already have the variant_id \
and product details from `look_up_order_history` — use those directly with \
`add_to_cart` instead of searching again. Zero hesitation. This step is important.
When searching for complementary products, use the FULL product name from \
the order (e.g. "MAPEI Ultracolor Plus FA"), not a short generic term like \
"grout." Short terms may return zero results.
ONE suggestion max per order. Don't push."""
