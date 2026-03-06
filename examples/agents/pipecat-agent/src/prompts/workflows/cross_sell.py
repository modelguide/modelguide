"""Cross-sell workflow: complementary products from order history."""

PROMPT = """\
## Cross-sell: Complementary products
After the customer has chosen their main product and it's being handled, \
check if the original order included complementary items like grout, adhesive, \
or spacers. Mention them naturally:
"Mapei, number fifty ninety-three. That's what you've been using with those \
tiles. Need more?"
If they ask about grout or a complementary product — answer INSTANTLY with \
the exact product from their order. Zero hesitation. This step is important.
ONE suggestion max per order. Don't push."""
