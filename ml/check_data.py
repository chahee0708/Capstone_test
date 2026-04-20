import pandas as pd

# ===== Nutrition Dataset =====
# 여러 인코딩 시도 (UTF-8 실패 시 자동으로 latin-1 사용)
csv_path = "eurisko/Nutrition Dataset (1).csv"
try:
    nut = pd.read_csv(csv_path, encoding='utf-8')
except UnicodeDecodeError:
    print("[INFO] UTF-8 실패, latin-1로 재시도")
    nut = pd.read_csv(csv_path, encoding='latin-1')

print("=" * 60)
print("Nutrition Dataset")
print("=" * 60)
print("Shape:", nut.shape)
print("Columns:", nut.columns.tolist())
print("\nHead:")
print(nut.head(3))
print("\nDtypes:")
print(nut.dtypes)

# ===== GI Dataset =====
gi = pd.read_excel("eurisko/glycemicindex.xlsx")

print("\n" + "=" * 60)
print("Glycemic Index Dataset")
print("=" * 60)
print("Shape:", gi.shape)
print("Columns:", gi.columns.tolist())
print("\nHead:")
print(gi.head(3))
print("\nDtypes:")
print(gi.dtypes)