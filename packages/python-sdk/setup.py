from setuptools import setup, find_packages

setup(
    name="syncpay-bd",
    version="2.0.0",
    description="Official Python SDK for SyncPay BD Automated MFS Gateway",
    author="SyncPay BD",
    author_email="support@syncpaybd.site",
    packages=find_packages(),
    python_requires=">=3.7",
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
)
