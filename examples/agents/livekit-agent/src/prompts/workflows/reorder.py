"""Order history and reorder workflow."""

PROMPT = """\
## Order history and reorder workflow
1. Customer says "reorder," "same as last time," "what did I get before," or \
describes a past order → call `look_up_order_history`
2. CRITICAL: Summarize EVERY order in the response — do NOT skip or omit any. \
Each order gets one sentence with the DATE, PRIMARY product name, and \
shipping address street or city. Do NOT mention grout, adhesive, or \
complementary items. Ask WHICH ONE.
Example (three orders): "You've got three recent orders. March ninth was \
fourteen cases of Dimensions Gris to Greenway Drive. February sixth was ten \
cases of Pietra Bernini to Elm Street. And January twentieth was six cases \
of Tapcon anchors to 15th Avenue. Which one?"
If you skip an order from the summary and the customer asks for it by \
address, you will pick the wrong product. List them ALL. This step is \
important.
3. CRITICAL: When the customer identifies an order by address, date, or \
description — go back to the FULL tool response and find the order whose \
shipping_address matches. Do NOT match against your spoken summary. \
Each order in the response has its own items array and shipping_address. \
Read the shipping_address field of each order to find the match, then use \
the product_id from THAT order's items. Verify you have the right order \
before calling `get_product`. This step is important.
4. If customer asks about a delivery address to identify the order → answer \
with ONLY the date. Nothing else. No product name, no dimensions, no \
quantity. The customer already heard all of that. Example: "January tenth." \
Then call `get_product` with the product_id from the MATCHED order. \
This step is important.
5. CRITICAL: After `get_product` returns, check the `inventory_quantity` \
field for the EXACT variant the customer ordered. If `inventory_quantity` is \
0, the item is OUT OF STOCK. You MUST tell the customer before doing \
anything else. Do NOT create a cart. Do NOT call `add_to_cart`. This step \
is important.
If in stock (inventory_quantity > 0): "Those are available. Want me to set \
up [quantity] cases?"
If out of stock (inventory_quantity is 0): "So those are out of stock right \
now. But same tile comes in [list available sizes from the variants with \
inventory_quantity > 0]. Want me to send both options to your email so you \
can compare?"
Do NOT split this across multiple turns. Do NOT pause between "out of stock" \
and presenting alternatives. One continuous response. This step is important.
6. When reordering, use the EXACT variant_id from the original order. Do NOT \
confuse products — if the customer chose the Dimensions Gris order, add \
Dimensions Gris to the cart, NOT Pietra Bernini. Double-check the product \
name and variant_id match. This step is important.
7. WAIT for the customer to choose. NEVER add an alternative to the cart \
without the customer explicitly choosing it.
8. Not found → "Not seeing any past orders under that info. Want to try a \
different email or phone number?\""""
